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
 * Identity declaration for one active substrate — structurally the same
 * shape the substrate registry's storage claims carry (strategy, prefix,
 * minimumDigits, displayTemplate). The search package stays registry-
 * agnostic: callers hand these in, nothing here imports server code.
 */
export interface IdentityDeclaration {
  strategy: string;
  prefix?: string | undefined;
  minimumDigits?: number | undefined;
  displayTemplate?: string | undefined;
}

/**
 * One derived ID-intent rule: recognize `<word><sep?><digits>` queries and
 * rebuild the substrate's canonical display id from them.
 */
export interface IdIntentSpec {
  /** Identity word matched case-insensitively, e.g. "ADR", "REF", "TASK". */
  word: string;
  /** Canonical-id text the key is appended to, e.g. "ADR " or "REF-". */
  idPrefix: string;
  /** Zero-pad the key's root segment to this many digits. */
  minimumDigits: number;
  /** Whether dotted thread keys ("0092.1") are valid for this substrate. */
  threaded: boolean;
}

const IDENTITY_KEY_PLACEHOLDER = '{key}';
const IDENTITY_WORD_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;

/**
 * Derive the ID-intent rule set from the active registry's identity
 * declarations (nav-01 plumbing fix, ADR 0121 R9). Docs-native substrates
 * mint display ids through their declared templates — space-form
 * ("ADR 0116"), hyphen-form ("REF-0004"), threaded ("ADR 0092.1") — so the
 * recognizable prefix vocabulary must come from those declarations, never
 * from a hardcoded list.
 *
 * Identities whose display ids carry no leading word (bare numbered
 * substrates) or that place text after the key produce no rule: their ids
 * cannot be recognized from a `<word> <digits>` query.
 */
export function idIntentSpecsFromIdentities(
  identities: readonly IdentityDeclaration[],
): IdIntentSpec[] {
  const specs = new Map<string, IdIntentSpec>();
  for (const identity of identities) {
    // Same template default as the storage-identity boundary.
    const template = identity.displayTemplate
      ?? (identity.prefix === undefined
        ? IDENTITY_KEY_PLACEHOLDER
        : `${identity.prefix}-${IDENTITY_KEY_PLACEHOLDER}`);
    const placeholderIndex = template.indexOf(IDENTITY_KEY_PLACEHOLDER);
    if (
      placeholderIndex < 0
      || placeholderIndex !== template.lastIndexOf(IDENTITY_KEY_PLACEHOLDER)
    ) continue;
    if (template.slice(placeholderIndex + IDENTITY_KEY_PLACEHOLDER.length) !== '') continue;
    const idPrefix = template.slice(0, placeholderIndex);
    const word = idPrefix.replace(/[-\s]+$/u, '');
    if (word === '' || !IDENTITY_WORD_PATTERN.test(word)) continue;
    const minimumDigits = Number.isInteger(identity.minimumDigits)
      && (identity.minimumDigits as number) >= 1
      ? (identity.minimumDigits as number)
      : 1;
    specs.set(word.toLowerCase(), {
      word,
      idPrefix,
      minimumDigits,
      threaded: identity.strategy === 'numbered-threaded',
    });
  }
  return [...specs.values()];
}

/**
 * Default rule set — the built-in substrates (TASK, EPIC, …) with their
 * canonical `PREFIX-0000` claims. Used when no registry has been supplied,
 * preserving the pre-registry behavior for standalone service use.
 */
export const BUILTIN_ID_INTENT_SPECS: readonly IdIntentSpec[] =
  idIntentSpecsFromIdentities(
    Object.values(TYPE_PREFIXES).map(prefix => ({
      strategy: 'prefixed-number',
      prefix,
      minimumDigits: 4,
    })),
  );

/**
 * Canonicalize a candidate ID-shaped query into a real entity ID, or null
 * if the query doesn't match. The whole (trimmed, single-spaced) query must
 * be the ID — partial matches like "task 596 viewer" do NOT short-circuit
 * (they may contain genuine fulltext intent).
 *
 * Both separator families canonicalize to the substrate's declared display
 * id: "ADR 0116" and "ADR-0116" → "ADR 0116"; "REF 4" and "REF-0004" →
 * "REF-0004". Thread-child keys round-trip for numbered-threaded
 * substrates ("ADR-0092.1" → "ADR 0092.1").
 *
 * Examples (built-in specs):
 *   "TASK-0596"  → "TASK-0596"
 *   "task-0596"  → "TASK-0596"
 *   "task 596"   → "TASK-0596"   (zero-padded to 4 digits)
 *   "epic 1"     → "EPIC-0001"
 *   "task596"    → "TASK-0596"
 *   "596"        → null          (ambiguous: which type?)
 *   "task 596 viewer" → null     (extra terms present)
 */
export function canonicalizeIdQuery(
  query: string,
  specs: readonly IdIntentSpec[] = BUILTIN_ID_INTENT_SPECS,
): string | null {
  // Collapse whitespace so "TASK   0596" still matches.
  const trimmed = query.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  for (const spec of specs) {
    const match = new RegExp(
      `^${spec.word}[-\\s]?(\\d+(?:\\.\\d+)*)$`,
      'i',
    ).exec(trimmed);
    const key = match?.[1];
    if (!key) continue;
    if (key.includes('.') && !spec.threaded) continue;
    const [root = '', ...childSegments] = key.split('.');
    // Pad the root to the declared width; wider inputs are preserved
    // (TASK-12345 stays as-is). Thread-child segments pass through.
    const paddedRoot = root.length >= spec.minimumDigits
      ? root
      : root.padStart(spec.minimumDigits, '0');
    return `${spec.idPrefix}${[paddedRoot, ...childSegments].join('.')}`;
  }
  return null;
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
  'memory': EntityType.Memory,
  'memories': EntityType.Memory,
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
 *
 * `specs` is the active registry's derived ID-intent rule set; omitting it
 * falls back to the built-in substrate prefixes.
 */
export function parseQueryIntent(
  query: string,
  specs: readonly IdIntentSpec[] = BUILTIN_ID_INTENT_SPECS,
): QueryIntent {
  const trimmed = query.trim();

  // 1. ID lookup wins if the entire query is ID-shaped.
  const canonicalId = canonicalizeIdQuery(trimmed, specs);
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
