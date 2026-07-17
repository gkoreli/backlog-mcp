/**
 * Semantic collision candidates (ADR 0120).
 *
 * Search generates a bounded neighbor order; this module discards raw search
 * scores and applies a deterministic, read-only pair fold. It has no write
 * dependency: adjudication remains an explicit human/agent action recorded in
 * Markdown through `distinct_from`, `supersedes`, `state_key`, or expiry.
 */
import type { Memory } from '@backlog-mcp/shared';
import { EntityType } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type {
  CollisionCandidate,
  CollisionCandidateMember,
  CollisionCandidatePair,
  CollisionCandidatesResult,
  ScoredCollisionPair,
} from './types.js';

export const COLLISION_NEIGHBOR_LIMIT = 8;
export const COLLISION_PRIORITY_THRESHOLD = 0.772159;

const NEIGHBOR_RANK_WEIGHT = 0.45;
const LEXICAL_OVERLAP_WEIGHT = 0.30;
const SCOPE_WEIGHT = 0.15;
const EPISTEMIC_SHAPE_WEIGHT = 0.10;
const DIGEST_LENGTH = 160;
const UTF8_ENCODER = new TextEncoder();

function compareBytewise(left: string, right: string): number {
  const leftBytes = UTF8_ENCODER.encode(left);
  const rightBytes = UTF8_ENCODER.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined) continue;
    if (leftByte < rightByte) return -1;
    if (leftByte > rightByte) return 1;
  }
  if (leftBytes.length < rightBytes.length) return -1;
  if (leftBytes.length > rightBytes.length) return 1;
  return 0;
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}

function isLive(memory: Memory, now: number): boolean {
  if (!memory.valid_until) return true;
  const expiry = Date.parse(memory.valid_until);
  return Number.isNaN(expiry) || expiry > now;
}

function hasSharedValue(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  const rightValues = new Set(right.filter(function isMeaningful(value) {
    return value.trim().length > 0;
  }));
  return left.some(function isShared(value) {
    return value.trim().length > 0 && rightValues.has(value);
  });
}

function isDismissed(left: Memory, right: Memory): boolean {
  return left.distinct_from?.includes(right.id) === true
    || right.distinct_from?.includes(left.id) === true;
}

function sharesAnchor(left: Memory, right: Memory): boolean {
  return hasSharedValue(left.entity_refs, right.entity_refs)
    || hasSharedValue(left.tags, right.tags);
}

function explicitContext(memory: Memory): string | undefined {
  return memory.parent_id !== undefined && memory.parent_id.length > 0
    ? memory.parent_id
    : undefined;
}

function isEligiblePair(left: Memory, right: Memory, now: number): boolean {
  if (left.id === right.id) return false;
  if (!isLive(left, now) || !isLive(right, now)) return false;
  if (isDismissed(left, right)) return false;
  const leftContext = explicitContext(left);
  const rightContext = explicitContext(right);
  if (
    leftContext !== undefined
    && rightContext !== undefined
    && leftContext !== rightContext
    && !sharesAnchor(left, right)
  ) {
    return false;
  }
  return true;
}

function normalizedTokens(memory: Memory): Set<string> {
  const text = `${memory.title}\n${memory.content}`
    .normalize('NFKC')
    .toLocaleLowerCase('en-US');
  return new Set(text.match(/[\p{L}\p{N}]+/gu) ?? []);
}

function lexicalOverlap(left: Memory, right: Memory): number {
  const leftTokens = normalizedTokens(left);
  const rightTokens = normalizedTokens(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function scopeSignal(left: Memory, right: Memory): number {
  const leftContext = explicitContext(left);
  const rightContext = explicitContext(right);
  if (
    leftContext !== undefined
    && leftContext === rightContext
  ) {
    return 1;
  }
  if (sharesAnchor(left, right)) return 0.8;

  const leftUnscoped = leftContext === undefined
    && (left.entity_refs?.length ?? 0) === 0
    && (left.tags?.length ?? 0) === 0;
  const rightUnscoped = rightContext === undefined
    && (right.entity_refs?.length ?? 0) === 0
    && (right.tags?.length ?? 0) === 0;
  return leftUnscoped && rightUnscoped ? 0.35 : 0.2;
}

function epistemicShape(left: Memory, right: Memory): number {
  const leftCurrent = (left.kind ?? 'current') === 'current';
  const rightCurrent = (right.kind ?? 'current') === 'current';
  if (leftCurrent && rightCurrent) return 1;
  return leftCurrent || rightCurrent ? 0.5 : 0;
}

/** Canonical identity for an unordered memory pair. */
export function collisionPairKey(leftId: string, rightId: string): string {
  const ids = compareBytewise(leftId, rightId) <= 0
    ? [leftId, rightId]
    : [rightId, leftId];
  return JSON.stringify(ids);
}

/**
 * Score one eligible pair from pure signals. Undefined means the pair is
 * structurally ineligible (self, non-live, dismissed, or cross-context).
 */
export function scoreCollisionPair(
  left: Memory,
  right: Memory,
  neighborRank: number,
  now: number = Date.now(),
): ScoredCollisionPair | undefined {
  if (!Number.isInteger(neighborRank) || neighborRank < 1) {
    throw new RangeError('neighborRank must be a positive integer');
  }
  if (!isEligiblePair(left, right, now)) return undefined;

  const rank = 1 / neighborRank;
  const overlap = lexicalOverlap(left, right);
  const scope = scopeSignal(left, right);
  const epistemic = epistemicShape(left, right);
  const priority = NEIGHBOR_RANK_WEIGHT * rank
    + LEXICAL_OVERLAP_WEIGHT * overlap
    + SCOPE_WEIGHT * scope
    + EPISTEMIC_SHAPE_WEIGHT * epistemic;

  return {
    pair_id: collisionPairKey(left.id, right.id),
    pair_priority: priority,
    signals: {
      neighbor_rank: roundSix(rank),
      lexical_overlap: roundSix(overlap),
      scope: roundSix(scope),
      epistemic_shape: roundSix(epistemic),
    },
  };
}

function digest(memory: Memory): string {
  const oneLine = memory.content.replace(/\s+/g, ' ').trim();
  return oneLine.length <= DIGEST_LENGTH
    ? oneLine
    : `${oneLine.slice(0, DIGEST_LENGTH - 1)}…`;
}

function toCandidate(
  memory: Memory,
  score: ScoredCollisionPair,
): CollisionCandidate {
  return {
    id: memory.id,
    title: memory.title,
    digest: digest(memory),
    pair_priority: score.pair_priority,
    signals: score.signals,
  };
}

function toMember(memory: Memory): CollisionCandidateMember {
  return {
    id: memory.id,
    title: memory.title,
    digest: digest(memory),
    ...(memory.kind === undefined ? {} : { kind: memory.kind }),
    ...(memory.parent_id === undefined ? {} : { context: memory.parent_id }),
    entity_refs: [...(memory.entity_refs ?? [])],
    tags: [...(memory.tags ?? [])],
  };
}

function compareCandidate(
  focalId: string,
  left: CollisionCandidate,
  right: CollisionCandidate,
): number {
  if (left.pair_priority !== right.pair_priority) {
    return right.pair_priority - left.pair_priority;
  }
  return compareBytewise(
    collisionPairKey(focalId, left.id),
    collisionPairKey(focalId, right.id),
  );
}

function memoryCorpus(entities: Awaited<ReturnType<IBacklogService['list']>>): Memory[] {
  return entities.filter(function isMemory(entity): entity is Memory {
    return entity.type === EntityType.Memory;
  });
}

async function candidatesForFocal(
  service: IBacklogService,
  focal: Memory,
  corpus: readonly Memory[],
  now: number,
): Promise<CollisionCandidate[]> {
  if (!isLive(focal, now)) return [];

  const byId = new Map(corpus.map(function indexMemory(memory) {
    return [memory.id, memory] as const;
  }));
  const ineligibleCount = corpus.filter(function countIneligible(memory) {
    return !isEligiblePair(focal, memory, now);
  }).length;
  const searchLimit = Math.min(
    corpus.length,
    COLLISION_NEIGHBOR_LIMIT + ineligibleCount,
  );
  if (searchLimit === 0) return [];

  const hits = await service.searchUnified(
    `${focal.title}\n${focal.content}`,
    { types: [EntityType.Memory], limit: searchLimit },
  );
  const candidates: CollisionCandidate[] = [];
  const seen = new Set<string>();
  let eligibleRank = 0;
  for (const hit of hits) {
    const memory = byId.get(hit.item.id);
    if (memory === undefined || seen.has(memory.id)) continue;
    seen.add(memory.id);
    if (!isEligiblePair(focal, memory, now)) continue;
    eligibleRank += 1;
    if (eligibleRank > COLLISION_NEIGHBOR_LIMIT) break;

    const score = scoreCollisionPair(focal, memory, eligibleRank, now);
    if (score === undefined || score.pair_priority < COLLISION_PRIORITY_THRESHOLD) {
      continue;
    }
    candidates.push(toCandidate(memory, score));
  }

  return candidates.sort(function sortCandidates(left, right) {
    return compareCandidate(focal.id, left, right);
  });
}

/** Find threshold-clearing candidates for one same-home focal memory. */
export async function findCollisionCandidatesForMemory(
  service: IBacklogService,
  focalId: string,
  options: { now?: number } = {},
): Promise<CollisionCandidate[]> {
  const now = options.now ?? Date.now();
  const corpus = memoryCorpus(await service.list({ type: EntityType.Memory }));
  const focal = corpus.find(function findFocal(memory) {
    return memory.id === focalId;
  });
  return focal === undefined ? [] : candidatesForFocal(service, focal, corpus, now);
}

function comparePairs(
  left: CollisionCandidatePair,
  right: CollisionCandidatePair,
): number {
  if (left.pair_priority !== right.pair_priority) {
    return right.pair_priority - left.pair_priority;
  }
  return compareBytewise(left.pair_id, right.pair_id);
}

/**
 * Find canonical candidate pairs for all live memories, or for an explicit
 * focal subset (the consolidation sweep). Search remains same-home because
 * the supplied service belongs to exactly one runtime.
 */
export async function findCollisionCandidatePairs(
  service: IBacklogService,
  options: { focalIds?: readonly string[]; now?: number } = {},
): Promise<CollisionCandidatesResult> {
  const now = options.now ?? Date.now();
  const corpus = memoryCorpus(await service.list({ type: EntityType.Memory }));
  const live = corpus.filter(function isLiveMemory(memory) {
    return isLive(memory, now);
  });
  const requested = options.focalIds === undefined
    ? undefined
    : new Set(options.focalIds);
  const focals = requested === undefined
    ? live
    : live.filter(function isRequested(memory) {
      return requested.has(memory.id);
    });
  const byId = new Map(live.map(function indexMemory(memory) {
    return [memory.id, memory] as const;
  }));
  const pairs = new Map<string, CollisionCandidatePair>();

  for (const focal of focals) {
    const candidates = await candidatesForFocal(service, focal, corpus, now);
    for (const candidate of candidates) {
      const other = byId.get(candidate.id);
      if (other === undefined) continue;
      const members = [focal, other].sort(function sortMembers(left, right) {
        return compareBytewise(left.id, right.id);
      });
      const first = members[0];
      const second = members[1];
      if (first === undefined || second === undefined) continue;

      const pair: CollisionCandidatePair = {
        pair_id: collisionPairKey(first.id, second.id),
        pair_priority: candidate.pair_priority,
        signals: candidate.signals,
        members: [toMember(first), toMember(second)],
      };
      const existing = pairs.get(pair.pair_id);
      if (
        existing === undefined
        || pair.pair_priority > existing.pair_priority
      ) {
        pairs.set(pair.pair_id, pair);
      }
    }
  }

  const ordered = [...pairs.values()].sort(comparePairs);
  return {
    pairs: ordered,
    total_live_memories: live.length,
    focal_count: focals.length,
    candidate_count: ordered.length,
  };
}
