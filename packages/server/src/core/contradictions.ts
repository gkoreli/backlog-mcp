/**
 * Contradiction detection — R-9 of the agentic memory initiative
 * (ADR 0092.13, implementing ADR 0092.5 R-9).
 *
 * The deterministic half of contradiction surfacing: a read-only fold that
 * finds memories which violate the state_key invariant. Per ADR 0092.5 R-2
 * (verified in memory-store-contract.test.ts), writing a memory with a
 * state_key soft-expires every live previous holder — so there is AT MOST
 * one live holder per key. Two live holders is the invariant breached
 * (direct store write, import, or a bug bypassing `remember`): a real
 * conflict worth a human's eyes.
 *
 * Detection only. Resolution is NEVER automatic (R-9, MemPalace's
 * 13-months-unshipped lesson): the agent/human acts through the existing
 * `remember` (supersedes / state_key) or `forget` verbs. This module has
 * no write path — it can show a contradiction, never revise a belief.
 *
 * The fuzzier near-duplicate-embedding detector (R-9's second signal) is
 * deferred (ADR 0092.13 §Deferred) — it needs the search stack and a
 * divergence threshold.
 */

import type { Entity, Memory } from '@backlog-mcp/shared';
import { EntityType } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type {
  ContradictionGroup,
  ContradictionMember,
  ContradictionsResult,
} from './types.js';

/** A memory is live if it has no expiry, or its expiry is still in the future. */
function isLive(m: Memory, now: number): boolean {
  if (!m.valid_until) return true;
  const ts = Date.parse(m.valid_until);
  return Number.isNaN(ts) || ts > now;
}

function toMember(m: Memory): ContradictionMember {
  return {
    id: m.id,
    title: m.title,
    created_at: m.created_at,
    ...(m.valid_until ? { valid_until: m.valid_until } : {}),
    entity_refs: m.entity_refs ?? [],
    ...(m.source ? { source: m.source } : {}),
  };
}

/**
 * Pure fold (ADR 0092.13): group LIVE memories by state_key; keep groups of
 * ≥2 — each is a breach of the one-live-holder-per-key invariant (R-2), i.e.
 * a contradiction set. Members are ordered newest-first so the most recent
 * (likely-correct) belief leads; groups are ordered by their newest member,
 * most recent contradiction first, then by key for stability.
 */
export function groupByStateKey(
  memories: Memory[],
  opts: { now?: number } = {},
): ContradictionGroup[] {
  const now = opts.now ?? Date.now();
  const byKey = new Map<string, Memory[]>();
  for (const m of memories) {
    if (!m.state_key || !isLive(m, now)) continue;
    const list = byKey.get(m.state_key);
    if (list) list.push(m);
    else byKey.set(m.state_key, [m]);
  }

  const groups: ContradictionGroup[] = [];
  for (const [state_key, members] of byKey) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    groups.push({
      state_key,
      members: sorted.map(toMember),
      count: sorted.length,
      newest_created_at: sorted[0]!.created_at,
    });
  }

  groups.sort((a, b) => {
    const d = Date.parse(b.newest_created_at) - Date.parse(a.newest_created_at);
    if (d !== 0) return d;
    return a.state_key.localeCompare(b.state_key);
  });
  return groups;
}

/**
 * Service edge (mirrors consolidationCandidates, ADR 0092.7): list Memory
 * entities and fold. Read-only, no injected IO — the substrate is the source.
 */
export async function detectContradictions(
  service: IBacklogService,
): Promise<ContradictionsResult> {
  const now = Date.now();
  const memories = (await service.list({ type: EntityType.Memory }))
    .map(e => e as Entity as Memory);
  const live_keyed = memories.filter(m => m.state_key && isLive(m, now)).length;
  const groups = groupByStateKey(memories, { now });
  return {
    groups,
    total_live_keyed: live_keyed,
    contradiction_count: groups.length,
  };
}

/**
 * The OTHER live holders of a memory's state_key — the per-memory view that
 * powers the viewer's `contradicts` field and contradiction chip. Empty when
 * the memory has no key, is expired, or is the sole holder (no conflict).
 */
export async function contradictsFor(
  service: IBacklogService,
  memory: Memory,
  now: number = Date.now(),
): Promise<string[]> {
  if (!memory.state_key || !isLive(memory, now)) return [];
  const memories = (await service.list({ type: EntityType.Memory }))
    .map(e => e as Entity as Memory);
  return memories
    .filter(m =>
      m.id !== memory.id && m.state_key === memory.state_key && isLive(m, now))
    .map(m => m.id);
}
