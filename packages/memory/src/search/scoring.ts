/**
 * Linear fusion scoring module (ADR-0081).
 *
 * Replaces the shadow scoring system (rerankWithSignals, normalizeScores,
 * getRecencyMultiplier) with independent retriever fusion.
 *
 * Architecture:
 *   BM25 hits → MinMax normalize → ┐
 *                                    ├→ weighted linear combination → post-fusion modifiers → ranked results
 *   Vector hits → MinMax normalize → ┘
 *
 * All functions are pure and independently testable without an Orama instance.
 */

import { compoundWordTokenizer } from './tokenizer.js';

/** A scored hit from a single retriever. */
export interface ScoredHit {
  id: string;
  score: number;
}

/** Default fusion weights: text-heavy for a backlog system where exact term matches matter. */
export const DEFAULT_WEIGHTS = { text: 0.7, vector: 0.3 } as const;

/**
 * MinMax normalize scores to [0,1] range per-retriever.
 *
 * Preserves relative score differences within a retriever while mapping
 * to a common scale for fusion. Handles edge cases:
 * - Empty array → empty array
 * - Single result → score 1.0 (it's the best and only result)
 * - All same score → all get 1.0 (equally relevant)
 */
export function minmaxNormalize(hits: ScoredHit[]): ScoredHit[] {
  if (hits.length === 0) return [];
  const scores = hits.map(h => h.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  if (range === 0) return hits.map(h => ({ ...h, score: 1.0 }));
  return hits.map(h => ({ ...h, score: (h.score - min) / range }));
}

/**
 * Rank-based normalization (ADR-0083 #10).
 *
 * MinMax normalization maps the lowest scorer to exactly 0.0, annihilating
 * relevant-but-low-BM25 documents (the TASK-0676 failure mode: a doc whose
 * query terms live in compound words in the description always loses to docs
 * with literal title hits, and MinMax then erases it entirely).
 *
 * Rank normalization scores by *position* instead of value:
 *   normalized = (n - rank) / n
 * where tied raw scores share the rank of their first occurrence. The lowest
 * scorer gets 1/n > 0 — it stays in the race for post-fusion modifiers
 * (decay, coordination, title pin) to act on.
 *
 * Edge cases match minmaxNormalize: empty → empty; single → 1.0;
 * all-same-score → all 1.0.
 */
export function rankNormalize(hits: ScoredHit[]): ScoredHit[] {
  if (hits.length === 0) return [];
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const n = sorted.length;
  const out: ScoredHit[] = [];
  let rankOfScore = 0;
  for (let i = 0; i < n; i++) {
    const h = sorted[i]!;
    if (i > 0 && h.score !== sorted[i - 1]!.score) rankOfScore = i;
    out.push({ ...h, score: (n - rankOfScore) / n });
  }
  return out;
}

/**
 * Linear fusion: weighted combination of normalized retriever scores (ADR-0081).
 *
 * For each document, computes:
 *   score = w_text * norm_bm25 + w_vector * norm_vector
 *
 * Documents appearing in only one retriever get 0 for the missing retriever's
 * contribution. This naturally handles BM25-only fallback when embeddings
 * are unavailable (vector hits empty → pure BM25 ranking).
 *
 * @param bm25Hits - MinMax-normalized BM25 retriever results
 * @param vectorHits - MinMax-normalized vector retriever results (empty if unavailable)
 * @param weights - Fusion weights (default: 0.7 text, 0.3 vector)
 * @returns Fused and sorted results
 */
export function linearFusion(
  bm25Hits: ScoredHit[],
  vectorHits: ScoredHit[],
  weights: { text: number; vector: number } = DEFAULT_WEIGHTS,
): ScoredHit[] {
  const scores = new Map<string, number>();

  for (const hit of bm25Hits) {
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + weights.text * hit.score);
  }
  for (const hit of vectorHits) {
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + weights.vector * hit.score);
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Default half-life for temporal decay, in days (ADR-0092.1).
 *
 * With a 30-day half-life, a 30-day-old document scores exactly half of a
 * same-day document with the same intrinsic relevance. After 60 days → 0.25,
 * after 90 days → 0.125. Picked as a reasonable default for engineering
 * backlogs where "the last month" is usually still hot context.
 */
export const DEFAULT_HALF_LIFE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Post-fusion temporal decay modifier (ADR-0092.1).
 *
 * Applies ``score *= 2^(-ageDays / halfLifeDays)`` to each hit, where
 * ``ageDays`` comes from the document's ``createdAt`` provided via
 * ``getCreatedAt``. Documents without a timestamp are left untouched — this
 * keeps decay opt-in per document, so timeless entities (ADRs, epics) can
 * skip the timestamp and preserve their rank.
 *
 * **Why half-life instead of ``λ``**: humans reason about "how long until
 * this loses half its relevance", not about ``λ`` in ``exp(-λ·t)``.
 * Internally: ``2^(-t/H) == exp(-t·ln(2)/H)``.
 *
 * **Where in the pipeline**: between ``linearFusion`` and
 * ``applyCoordinationBonus``. Decay shapes the candidate order before the
 * coordination bonus reinforces it — applying decay *after* coordination
 * would let a title-match bonus on a two-year-old task outrank recent work,
 * the opposite of what "recency matters" means.
 *
 * @param hits - Fused results with scores
 * @param getCreatedAt - Function returning epoch ms for a doc, or undefined
 *                      (missing timestamp → no decay applied to that hit)
 * @param opts.halfLifeDays - Half-life in days (default: 30)
 * @param opts.now - Reference time in epoch ms (default: Date.now()) — exposed
 *                   for deterministic tests
 * @returns Re-scored results, sorted by decayed score descending
 */
export function applyTemporalDecay(
  hits: ScoredHit[],
  getCreatedAt: (id: string) => number | undefined,
  opts: { halfLifeDays?: number; now?: number } = {},
): ScoredHit[] {
  if (hits.length === 0) return hits;
  const halfLifeDays = opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  if (halfLifeDays <= 0) return hits;  // disabled → no-op
  const now = opts.now ?? Date.now();

  return hits
    .map(h => {
      const createdAt = getCreatedAt(h.id);
      if (createdAt === undefined || createdAt === null) return h;
      const ageDays = Math.max(0, (now - createdAt) / MS_PER_DAY);
      const decay = Math.pow(2, -ageDays / halfLifeDays);
      return { ...h, score: h.score * decay };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Post-fusion coordination bonus for multi-term queries (ADR-0081).
 *
 * In OR mode (tolerance=1), BM25 returns documents matching ANY query term.
 * A single "feature" in a boosted title field can outscore "feature"+"store"
 * in description. This modifier rewards documents matching ALL query terms,
 * which is a standard IR coordination factor (Lucene had coord() for years).
 *
 * Title coordination gets extra weight: if all query terms appear in the title,
 * the document gets a larger bonus than body-only matches. This ensures
 * "backlog mcp" → EPIC-0002 ("Backlog MCP: Product Design & Vision") ranks
 * above tasks that merely mention "backlog" and "mcp" in references.
 *
 * @param hits - Fused results with scores
 * @param query - Original search query
 * @param getText - Function to retrieve full searchable text for a document ID
 * @param getTitle - Function to retrieve title for a document ID
 * @returns Re-scored results, sorted by adjusted score
 */
export function applyCoordinationBonus(
  hits: ScoredHit[],
  query: string,
  getText: (id: string) => string,
  getTitle?: (id: string) => string,
): ScoredHit[] {
  const queryWords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (queryWords.length <= 1) return hits;

  return hits
    .map(h => {
      // Tokenize the document text the same way Orama does, so compound words
      // like "FeatureStore" expand to ["featurestore", "feature", "store"]
      const bodyTokens = new Set(compoundWordTokenizer.tokenize(getText(h.id)));
      const bodyMatchCount = queryWords.filter(w => bodyTokens.has(w)).length;
      const bodyCoord = bodyMatchCount / queryWords.length;

      // Title coordination: extra bonus when query terms match in the title
      let titleBonus = 0;
      if (getTitle) {
        const titleTokens = new Set(compoundWordTokenizer.tokenize(getTitle(h.id)));
        const titleMatchCount = queryWords.filter(w => titleTokens.has(w)).length;
        titleBonus = (titleMatchCount / queryWords.length) * 0.3;
      }

      // Body coordination (0.5 max) + title coordination (0.3 max)
      return { ...h, score: h.score + bodyCoord * 0.5 + titleBonus };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Additive offset applied to exact-title-phrase matches. Chosen to clear the
 * maximum possible non-pinned score (fusion ≤1.0 + coordination ≤0.8) so a
 * pinned doc always ranks above non-pinned docs, while pinned docs keep their
 * relative pre-pin order (the offset is constant, not a score override).
 */
export const TITLE_PIN_BONUS = 2.0;

/**
 * Exact/phrase title-match pin (ADR-0083 #8).
 *
 * Navigational queries (~30% of searches) name the thing the user wants:
 * "backlog mcp" → the "backlog-mcp 10x" epic. When every query token appears
 * as a *contiguous run* in a document's tokenized title, that document is
 * pinned above all non-pinned results. This is how Typesense/Algolia rank by
 * default (`prioritize_exact_match`).
 *
 * Applied as the FINAL pipeline stage — after fusion, decay, and
 * coordination — so a navigational hit beats recency decay (naming a thing
 * exactly is a stronger signal than its age).
 *
 * Conservative by design:
 * - Multi-token queries: all tokens must appear contiguously, in order, in
 *   the title's token sequence (compound-tokenized, so "backlog mcp" matches
 *   the title "backlog-mcp 10x").
 * - Single-token queries: pinned only when the token IS the entire title —
 *   otherwise one common word ("feature") would pin half the corpus.
 */
export function applyExactTitlePin(
  hits: ScoredHit[],
  query: string,
  getTitle: (id: string) => string,
): ScoredHit[] {
  const queryTokens = tokenizeWords(query);
  if (queryTokens.length === 0) return hits;

  return hits
    .map(h => {
      const titleTokens = tokenizeWords(getTitle(h.id));
      const pinned = queryTokens.length === 1
        ? titleTokens.length === 1 && titleTokens[0] === queryTokens[0]
        : containsContiguous(titleTokens, queryTokens);
      return pinned ? { ...h, score: h.score + TITLE_PIN_BONUS } : h;
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Tokenize into word-position-preserving tokens for phrase matching.
 *
 * Unlike `compoundWordTokenizer.tokenize` (which dedupes and appends compound
 * expansions, destroying positions), this keeps one token per source word but
 * ALSO returns each compound word's parts inline so "backlog-mcp 10x" yields
 * ["backlog", "mcp", "10x"] and the phrase "backlog mcp" matches contiguously.
 */
function tokenizeWords(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[^a-zA-Z0-9'-]+/).filter(Boolean)) {
    if (raw.includes('-')) {
      out.push(...raw.toLowerCase().split(/-+/).filter(Boolean));
    } else {
      const parts = compoundWordTokenizer.tokenize(raw);
      // tokenize("FeatureStore") → ["featurestore","feature","store"];
      // take the expansion (positions) when present, else the word itself.
      if (parts.length > 1) out.push(...parts.slice(1));
      else out.push(...parts);
    }
  }
  return out;
}

/** True when `needle` appears as a contiguous subsequence of `haystack`. */
function containsContiguous(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
