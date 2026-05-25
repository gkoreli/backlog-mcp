/**
 * Query intent parser (ADR 0083 #4).
 *
 * Routes queries to the right retrieval strategy *before* BM25 runs:
 *   - `id_lookup`  — query is an entity ID, do a direct cache hit
 *   - `filtered`   — query is purely status/type intent, strip those words
 *                    and apply native Orama `where` filters
 *   - `fulltext`   — everything else, run the BM25 + fusion pipeline
 *
 * Rule-based and intentionally simple. No ML. The cost of being wrong is
 * "fall through to fulltext" — the existing pipeline still runs as a
 * safety net for everything except an unambiguous ID match.
 */

import { TYPE_PREFIXES, EntityType, type Status } from '@backlog-mcp/shared';

export interface QueryIntent {
  /** How the query should be retrieved. */
  type: 'id_lookup' | 'filtered' | 'fulltext';
  /** Canonicalized entity ID, only set when type === 'id_lookup'. */
  id?: string;
  /** Native Orama filters to apply, only set when type === 'filtered'. */
  filters?: { status?: Status[]; type?: EntityType };
  /** Remaining query text for BM25. May be empty when type === 'filtered'. */
  query: string;
}

// ── ID detection ────────────────────────────────────────────────────

/**
 * Map lowercase prefix → uppercase prefix used in canonical IDs.
 * Built from `TYPE_PREFIXES` so adding a new substrate updates this for free.
 */
const PREFIX_LOOKUP: Record<string, string> = Object.fromEntries(
  Object.values(TYPE_PREFIXES).map(p => [p.toLowerCase(), p]),
);

/**
 * Pattern: a known prefix, optional separator (hyphen/space/none), digits.
 * Group 1: prefix. Group 2: digits.
 */
const ID_INTENT_PATTERN: RegExp = (() => {
  const prefixes = Object.keys(PREFIX_LOOKUP).join('|');
  return new RegExp(`^(${prefixes})[-\\s]?(\\d+)$`, 'i');
})();

/**
 * Canonicalize a candidate ID-shaped query into a real entity ID, or null
 * if the query doesn't match. The whole (trimmed, single-spaced) query must
 * be the ID — partial matches like "task 596 viewer" do NOT short-circuit
 * (they may contain genuine fulltext intent).
 *
 * Examples:
 *   "TASK-0596"  → "TASK-0596"
 *   "task-0596"  → "TASK-0596"
 *   "task 596"   → "TASK-0596"   (zero-padded to 4 digits)
 *   "epic 1"     → "EPIC-0001"
 *   "task596"    → "TASK-0596"
 *   "596"        → null          (ambiguous: which type?)
 *   "task 596 viewer" → null     (extra terms present)
 */
export function canonicalizeIdQuery(query: string): string | null {
  // Collapse whitespace so "TASK   0596" still matches.
  const trimmed = query.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  const match = ID_INTENT_PATTERN.exec(trimmed);
  if (!match || !match[1] || !match[2]) return null;

  const prefix = PREFIX_LOOKUP[match[1].toLowerCase()];
  if (!prefix) return null;

  // Pad numeric portion to at least 4 digits to match canonical ID format.
  // Inputs that already exceed 4 digits are preserved (TASK-12345 stays as-is).
  const digits = match[2].length >= 4 ? match[2] : match[2].padStart(4, '0');
  return `${prefix}-${digits}`;
}

// ── Status / type detection ─────────────────────────────────────────

const STATUS_WORDS: Record<string, Status> = {
  'open': 'open',
  'in_progress': 'in_progress',
  'in-progress': 'in_progress',
  'blocked': 'blocked',
  'done': 'done',
  'closed': 'done',     // alias users sometimes type
  'completed': 'done',  // alias
  'cancelled': 'cancelled',
  'canceled': 'cancelled',  // US/UK spelling
};

const TYPE_WORDS: Record<string, EntityType> = {
  'task': EntityType.Task,
  'tasks': EntityType.Task,
  'epic': EntityType.Epic,
  'epics': EntityType.Epic,
  'folder': EntityType.Folder,
  'folders': EntityType.Folder,
  'artifact': EntityType.Artifact,
  'artifacts': EntityType.Artifact,
  'milestone': EntityType.Milestone,
  'milestones': EntityType.Milestone,
  'cron': EntityType.Cron,
  'crons': EntityType.Cron,
};

/**
 * Multi-word phrases that should be detected as a single status token before
 * single-word matching. ("in progress" → "in_progress").
 */
const STATUS_PHRASES: Array<[RegExp, Status]> = [
  [/\bin\s+progress\b/i, 'in_progress'],
];

/**
 * Strip leading status/type words from a query and return the captured filters
 * plus the remaining text.
 *
 * Operates only on a *prefix* of the query — once we hit a word we don't
 * recognize as a filter token, we stop and treat the rest as fulltext. This
 * keeps the heuristic predictable: "blocked tasks about database" decomposes
 * to filters + "about database", but "tasks I have blocked" keeps everything
 * as fulltext (the leading word is "tasks", we strip it; next word is "i"
 * which isn't a filter token, so we stop).
 *
 * Returns null if no leading filter words were detected. Callers can then
 * route to fulltext without a roundtrip through filters.
 */
export function extractLeadingFilters(query: string): { filters: { status?: Status[]; type?: EntityType }; remaining: string } | null {
  let working = query.trim();
  if (!working) return null;

  // Phrases first (so "in progress tasks" is recognized).
  const detectedStatuses: Set<Status> = new Set();
  for (const [re, status] of STATUS_PHRASES) {
    const phraseMatch = re.exec(working);
    if (phraseMatch && phraseMatch.index === 0) {
      detectedStatuses.add(status);
      working = working.slice(phraseMatch[0].length).trim();
    }
  }

  let detectedType: EntityType | undefined;

  // Greedy single-word strip from the front.
  while (working) {
    const spaceIdx = working.indexOf(' ');
    const head = spaceIdx === -1 ? working : working.slice(0, spaceIdx);
    const lower = head.toLowerCase();

    if (lower in STATUS_WORDS) {
      detectedStatuses.add(STATUS_WORDS[lower]!);
    } else if (lower in TYPE_WORDS) {
      if (detectedType === undefined) {
        detectedType = TYPE_WORDS[lower];
      } else {
        break;  // second type word → stop stripping, treat as remaining text
      }
    } else {
      break;  // unknown word → stop stripping
    }

    working = spaceIdx === -1 ? '' : working.slice(spaceIdx + 1).trim();
  }

  if (detectedStatuses.size === 0 && detectedType === undefined) return null;

  const filters: { status?: Status[]; type?: EntityType } = {};
  if (detectedStatuses.size > 0) filters.status = Array.from(detectedStatuses);
  if (detectedType !== undefined) filters.type = detectedType;

  return { filters, remaining: working };
}

// ── Public entry point ──────────────────────────────────────────────

/**
 * Classify a search query and produce a `QueryIntent` describing how to
 * retrieve it. Always succeeds — the default route is `fulltext`.
 */
export function parseQueryIntent(query: string): QueryIntent {
  const trimmed = query.trim();

  // 1. ID lookup wins if the entire query is ID-shaped.
  const canonicalId = canonicalizeIdQuery(trimmed);
  if (canonicalId !== null) {
    return { type: 'id_lookup', id: canonicalId, query: trimmed };
  }

  // 2. Leading status/type words → filter intent (with possibly empty query
  //    remainder, e.g. "blocked tasks").
  //    Guard: if the remaining text starts with a digit, it's likely a near-miss
  //    ID query ("task 596 viewer") — fall through to fulltext instead.
  const filterMatch = extractLeadingFilters(trimmed);
  if (filterMatch && !/^\d/.test(filterMatch.remaining)) {
    return { type: 'filtered', filters: filterMatch.filters, query: filterMatch.remaining };
  }

  // 3. Default: full-text BM25 path.
  return { type: 'fulltext', query: trimmed };
}
