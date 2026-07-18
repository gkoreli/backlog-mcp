/**
 * The Desk core fold (attention-viewer proposal, PROMPT 0007) — a wakeup
 * for the human.
 *
 * One deterministic, transport-free fold composes the four attention
 * classes from store state:
 *
 *   JUDGE  — decision-shaped documents (ADRs/proposals) whose status token
 *            is open-decision-shaped, plus documents carrying the
 *            reconciliation sweep's `attention:` frontmatter marker.
 *   REVIEW — machine-surfaced bounded verdicts: collision-candidate pairs
 *            (ADR 0120's fold, reused), claim quarantines (EXP-1 B-3),
 *            and mined evaluation candidates awaiting the human tier.
 *   READ   — law-shaped documents (vision/prompts/requirements + ADRs)
 *            changed inside the recency window, agent-authored first.
 *   HEALTH — requirement compliance worst-first (ADR 0113.1's constraint
 *            fold reused verbatim).
 *
 * Laws (all inherited from the proposal, none new):
 *   - ≤ DESK_BUDGET items above the fold TOTAL, worst-first ACROSS classes
 *     via declared severity bands (the constraint-band precedent).
 *   - Per-class honest omission counts; nothing leaves the Desk because
 *     the UI hid it — only because the store changed.
 *   - Every item carries why_surfaced (one testable sentence) and a
 *     copy-ready agent instruction. No LLM, no heuristics: every class is
 *     a declared, testable rule over store state.
 *   - Core is transport-free (ADR 0090): documents, evaluation candidates,
 *     and grounding arrive as injected plain data; no fs/git/LLM here.
 */

import type { RuntimeEntity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import {
  COLLISION_PRIORITY_THRESHOLD,
  compareBytewise,
  findCollisionCandidatePairs,
} from './collision-candidates.js';
import { parseTimestampUtc } from './utc-timestamp.js';
import { isNorthStarFilename } from './orientation.js';
import {
  REQUIREMENT_TYPE,
  compareConstraints,
  isActiveConstraint,
  toConstraintStub,
  type ConstraintStub,
} from './requirements/constraint-stub.js';
import { statusToken } from './status-token.js';
import type {
  DeskClass,
  DeskDocument,
  DeskItem,
  DeskParams,
  DeskResult,
} from './desk.types.js';

/** Tenet 2 applied to humans: a bounded page, worst-first, or it is broken. */
export const DESK_BUDGET = 7;

/** READ window: a law-shaped change older than this has left the delta. */
export const DESK_READ_WINDOW_DAYS = 7;

/**
 * Composition bounds (review 0001 HIGH-2): the seven-item output law never
 * bounded composition WORK. These caps do — and every cap that bites is
 * disclosed through the fold's named-omission diagnostics, never silent.
 */
/** Collision scan: at most this many most-recent live focal memories. */
export const DESK_COLLISION_FOCAL_LIMIT = 200;
/** Requirement scan: a sane page, not the 100k firehose. */
export const DESK_REQUIREMENTS_LIMIT = 500;

/**
 * Open-decision-shaped status tokens (leading-token rule, BUG-0003 seam).
 * "Proposed (goga, 2026-07-16)" → proposed. A missing status is not a
 * decision — fail-closed, like wakeup's declared-status filters.
 */
export const JUDGE_STATUS_TOKENS: ReadonlySet<string> = new Set([
  'proposed',
  'open',
  'draft',
  'parked',
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * JUDGE worst-first weights (age × weight): an explicit attention marker
 * outranks an ADR, an ADR outranks a proposal — a stale structural ruling
 * costs more per day than a stale idea.
 */
const JUDGE_WEIGHT = { attention: 3, adr: 2, proposal: 1 } as const;

type DocShape = 'adr' | 'proposal' | 'prompt' | 'requirement' | 'vision' | 'other';

/**
 * Declared path rule, not a classifier: shape comes from the document's
 * folder segment (adr/proposals/prompts/requirements) or the north-star
 * filename rule. Anything else is 'other' and only ever surfaces through
 * an explicit attention marker.
 */
export function deskDocShape(path: string): DocShape {
  const segments = path.split('/');
  const filename = segments.at(-1) ?? path;
  if (isNorthStarFilename(filename)) return 'vision';
  if (segments.includes('adr')) return 'adr';
  if (segments.includes('proposals')) return 'proposal';
  if (segments.includes('prompts')) return 'prompt';
  if (segments.includes('requirements')) return 'requirement';
  return 'other';
}

const LAW_SHAPES: ReadonlySet<DocShape> = new Set([
  'vision',
  'prompt',
  'requirement',
  'adr',
]);

interface DocumentAge {
  /** Whole days since the timestamp, clamped at 0. */
  days: number;
  /**
   * The timestamp sits in the future (review 0001): age clamps to 0 but the
   * item carries a `future-dated` marker — a typo must not sit fresh forever
   * without saying so.
   */
  future: boolean;
}

function documentAge(iso: string | undefined, now: number): DocumentAge | undefined {
  if (iso === undefined) return undefined;
  const ts = parseTimestampUtc(iso);
  if (Number.isNaN(ts)) return undefined;
  return {
    days: Math.max(0, Math.floor((now - ts) / MS_PER_DAY)),
    future: ts > now,
  };
}

function futureMark(age: DocumentAge | undefined): string {
  return age?.future === true ? ' (future-dated)' : '';
}

function comparePathAsc(a: { path?: string; id: string }, b: { path?: string; id: string }): number {
  return compareBytewise(a.path ?? a.id, b.path ?? b.id);
}

// ── JUDGE ────────────────────────────────────────────────────────────────

interface JudgeCandidate {
  item: DeskItem;
  priority: number;
}

function isJudgeStatus(doc: DeskDocument): boolean {
  const shape = deskDocShape(doc.path);
  if (shape !== 'adr' && shape !== 'proposal') return false;
  const token = statusToken(doc.status);
  return token !== undefined && JUDGE_STATUS_TOKENS.has(token);
}

function isJudgeDocument(doc: DeskDocument): boolean {
  return doc.attention !== undefined || isJudgeStatus(doc);
}

function judgeCandidate(doc: DeskDocument, now: number): JudgeCandidate {
  const age = documentAge(doc.updatedAt, now);
  const shape = deskDocShape(doc.path);
  const attention = doc.attention;
  const weight = attention !== undefined
    ? JUDGE_WEIGHT.attention
    : shape === 'adr' ? JUDGE_WEIGHT.adr : JUDGE_WEIGHT.proposal;

  let why: string;
  let instruction: string;
  if (attention !== undefined) {
    why = attention === ''
      ? `Carries an attention: frontmatter marker.${futureMark(age)}`
      : `Marked for attention: ${attention}${futureMark(age)}`;
    instruction = `Resolve the attention marker on ${doc.path}`
      + `${attention === '' ? '' : ` (${attention})`},`
      + ' then remove the attention key from its frontmatter.';
  } else {
    why = age === undefined
      ? `Status "${doc.status ?? ''}" awaits a ruling.`
      : `Status "${doc.status ?? ''}" has awaited a ruling for ${age.days} day${age.days === 1 ? '' : 's'}${futureMark(age)}.`;
    instruction = `Adjudicate ${doc.path} ("${doc.title}"):`
      + ' rule on it and update its status frontmatter with the ruling and a one-line rationale.';
  }

  return {
    priority: weight * ((age?.days ?? 0) + 1),
    item: {
      id: doc.path,
      title: doc.title,
      class: 'judge',
      why_surfaced: why,
      instruction,
      ...(age === undefined ? {} : { age_days: age.days }),
      path: doc.path,
      ...(doc.author === undefined ? {} : { agent: doc.author }),
    },
  };
}

// ── READ ─────────────────────────────────────────────────────────────────

interface ReadCandidate {
  item: DeskItem;
  agentAuthored: boolean;
  updatedAt: string;
}

function readCandidate(doc: DeskDocument, age: DocumentAge): ReadCandidate {
  const shape = deskDocShape(doc.path);
  const byline = doc.author === undefined ? '' : ` by ${doc.author}`;
  return {
    agentAuthored: doc.author !== undefined,
    updatedAt: doc.updatedAt ?? '',
    item: {
      id: doc.path,
      title: doc.title,
      class: 'read',
      why_surfaced: `Law-shaped ${shape} changed ${age.days} day${age.days === 1 ? '' : 's'} ago${byline}${futureMark(age)}.`,
      instruction: `Summarize what changed in ${doc.path} and any consequences for in-flight work.`,
      age_days: age.days,
      path: doc.path,
      ...(doc.author === undefined ? {} : { agent: doc.author }),
    },
  };
}

// ── HEALTH ───────────────────────────────────────────────────────────────

function healthItem(stub: ConstraintStub): DeskItem {
  const violations = stub.violations;
  const checked = stub.checked_days_ago === undefined
    ? 'never assessed'
    : `checked ${stub.checked_days_ago} day${stub.checked_days_ago === 1 ? '' : 's'} ago`;
  const withViolations = violations === undefined
    ? ''
    : ` with ${violations.count} violation${violations.count === 1 ? '' : 's'}`;
  const remedy = violations === undefined
    ? 'verify current compliance and update its compliance and checked_at frontmatter.'
    : `resolve ${violations.ids.join(', ')}`
      + `${violations.count > violations.ids.length ? ` and ${violations.count - violations.ids.length} more` : ''},`
      + ' then update its compliance and checked_at frontmatter.';
  return {
    id: stub.id,
    title: stub.title,
    class: 'health',
    why_surfaced: `Compliance "${stub.compliance}"${withViolations}, ${checked}.`,
    instruction: `Restore requirement ${stub.id} ("${stub.title}"): ${remedy}`,
    ...(stub.checked_days_ago === undefined ? {} : { age_days: stub.checked_days_ago }),
  };
}

// ── The fold ─────────────────────────────────────────────────────────────

export async function desk(
  service: IBacklogService,
  params: DeskParams = {},
): Promise<DeskResult> {
  const now = params.now ?? Date.now();
  const diagnostics: string[] = [];
  const documents = params.readDocuments?.() ?? [];

  // JUDGE — open-decision statuses + attention markers, worst-first by
  // age × weight; path ascending as the final deterministic tiebreak.
  const judged = documents.filter(isJudgeDocument);
  const judgeItems = judged
    .map(function toJudgeCandidate(doc) {
      return judgeCandidate(doc, now);
    })
    .sort(function worstFirst(a, b) {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return comparePathAsc(a.item, b.item);
    })
    .map(function unwrapJudge(candidate) {
      return candidate.item;
    });
  const judgePaths = new Set(judged.map(function getPath(doc) {
    return doc.path;
  }));

  // REVIEW / quarantine — claimed documents that could not compile. The
  // detection is storage's (EXP-1 B-3); the Desk only restates it.
  const quarantineItems: DeskItem[] = (service.listClaimQuarantines?.() ?? [])
    .map(function toQuarantineItem(entry): DeskItem {
      return {
        id: entry.sourcePath,
        title: entry.sourcePath.split('/').at(-1) ?? entry.sourcePath,
        class: 'review',
        why_surfaced: `Claimed as ${entry.type} but quarantined: ${entry.reason}.`,
        instruction: `Repair ${entry.sourcePath} so it compiles as a ${entry.type} document (${entry.reason}).`,
        path: entry.sourcePath,
      };
    })
    .sort(comparePathAsc);

  // REVIEW / collisions — ADR 0120's fold reused, never reimplemented.
  // Search unavailability degrades to a named diagnostic, never a silent
  // clean scan. The scan is bounded to the most recent live focals
  // (review 0001 HIGH-2); a cap that bites is disclosed the same way.
  let collisionItems: DeskItem[] = [];
  try {
    const collisions = await findCollisionCandidatePairs(service, {
      now,
      focalLimit: DESK_COLLISION_FOCAL_LIMIT,
    });
    if (collisions.total_live_memories > DESK_COLLISION_FOCAL_LIMIT) {
      diagnostics.push(
        `Review omission: collision scan capped at the ${DESK_COLLISION_FOCAL_LIMIT}`
        + ` most recent of ${collisions.total_live_memories} live memories.`,
      );
    }
    collisionItems = collisions.pairs.map(function toCollisionItem(pair): DeskItem {
      const [left, right] = pair.members;
      return {
        id: pair.pair_id,
        title: `${left.id} ↔ ${right.id}: ${left.title} / ${right.title}`,
        class: 'review',
        why_surfaced: `Collision priority ${pair.pair_priority.toFixed(3)} clears the ${COLLISION_PRIORITY_THRESHOLD} review threshold.`,
        instruction: `Adjudicate collision ${left.id} ↔ ${right.id}: supersede one, merge them under a shared state_key, or mark distinct_from with a one-line rationale.`,
      };
    });
  } catch (error) {
    diagnostics.push(
      `Collision scan unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // REVIEW / evaluation candidates — the miner's records restated; files
  // with zero undisposed candidates stay off the Desk (reviewed candidates
  // leave — review 0001; empty is honest, not hidden). Files the reader
  // could not honestly count are disclosed, never silently dropped.
  const evaluationFiles = params.readEvaluationCandidates?.() ?? [];
  for (const file of evaluationFiles) {
    if (file.omission !== undefined) {
      diagnostics.push(
        `Review omission: candidate file ${file.path} skipped — ${file.omission}.`,
      );
    }
  }
  const evaluationItems: DeskItem[] = evaluationFiles
    .filter(function hasCandidates(file) {
      return file.omission === undefined && file.candidateCount > 0;
    })
    .map(function toEvaluationItem(file): DeskItem {
      return {
        id: file.path,
        title: file.path.split('/').at(-1) ?? file.path,
        class: 'review',
        why_surfaced: `${file.candidateCount} mined candidate${file.candidateCount === 1 ? ' carries' : 's carry'} no candidate_disposition record.`,
        instruction: `Review the ${file.candidateCount} candidate${file.candidateCount === 1 ? '' : 's'} in ${file.path} per docs/evaluation/JUDGING.md and append one candidate_disposition record per adjudicated candidate.`,
        path: file.path,
      };
    })
    .sort(comparePathAsc);

  // READ — the curated law delta, never an activity feed. A document that
  // already sits in JUDGE never repeats here (one fact, one item).
  const readItems = documents
    .flatMap(function toReadCandidate(doc): ReadCandidate[] {
      if (judgePaths.has(doc.path)) return [];
      if (!LAW_SHAPES.has(deskDocShape(doc.path))) return [];
      const age = documentAge(doc.updatedAt, now);
      if (age === undefined || age.days > DESK_READ_WINDOW_DAYS) return [];
      return [readCandidate(doc, age)];
    })
    .sort(function agentAuthoredFreshFirst(a, b) {
      if (a.agentAuthored !== b.agentAuthored) return a.agentAuthored ? -1 : 1;
      const recency = compareBytewise(b.updatedAt, a.updatedAt);
      if (recency !== 0) return recency;
      return comparePathAsc(a.item, b.item);
    })
    .map(function unwrapRead(candidate) {
      return candidate.item;
    });

  // HEALTH — 0113.1's constraint ordering reused verbatim; only violated /
  // at_risk are standing violations (satisfied and unchecked are not news).
  // Bounded scan (review 0001 HIGH-2): a full page means the cap may have
  // bitten, and the fold says so rather than pretending it read everything.
  const requirements = await service.list({
    type: REQUIREMENT_TYPE,
    limit: DESK_REQUIREMENTS_LIMIT,
  });
  if (requirements.length >= DESK_REQUIREMENTS_LIMIT) {
    diagnostics.push(
      `Health omission: requirement scan capped at ${DESK_REQUIREMENTS_LIMIT};`
      + ' requirements beyond the cap were not assessed.',
    );
  }
  const constraints = requirements
    .map(function toStub(entity) {
      return {
        stub: toConstraintStub(entity as RuntimeEntity, now),
        updated_at: typeof entity.updated_at === 'string' ? entity.updated_at : '',
      };
    })
    .filter(function isLive({ stub }) {
      return isActiveConstraint(stub);
    })
    .sort(compareConstraints)
    .map(function unwrapStub({ stub }) {
      return stub;
    });
  const healthViolated = constraints
    .filter(function isViolated(stub) {
      return stub.compliance === 'violated';
    })
    .map(healthItem);
  const healthAtRisk = constraints
    .filter(function isAtRisk(stub) {
      return stub.compliance === 'at_risk';
    })
    .map(healthItem);

  // Worst-first ACROSS classes by declared severity bands (the constraint
  // band precedent, page-level):
  //   band 0 — standing breakage: violated requirements, quarantines
  //   band 1 — bounded human verdicts: collisions, candidate qrels, at-risk
  //   band 2 — decisions waiting: JUDGE by age × weight
  //   band 3 — the reading delta
  const ordered: DeskItem[] = [
    ...healthViolated,
    ...quarantineItems,
    ...collisionItems,
    ...evaluationItems,
    ...healthAtRisk,
    ...judgeItems,
    ...readItems,
  ];

  const items = ordered.slice(0, DESK_BUDGET);
  const omitted: Record<DeskClass, number> = { judge: 0, review: 0, read: 0, health: 0 };
  for (const item of ordered.slice(DESK_BUDGET)) {
    omitted[item.class] += 1;
  }

  const worktree = params.readGrounding?.()?.worktree;

  return {
    items,
    omitted,
    metadata: {
      generated_at: new Date(now).toISOString(),
      budget: DESK_BUDGET,
      ...(worktree === undefined ? {} : {
        worktree: `${worktree.family} @ ${worktree.branch}, `
          + `${worktree.behind} behind ${worktree.defaultBranch}`,
      }),
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
    },
  };
}
