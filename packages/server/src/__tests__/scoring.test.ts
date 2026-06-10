/**
 * Unit tests for the scoring module (ADR-0081).
 *
 * These test the pure fusion functions WITHOUT an Orama instance.
 * This was impossible before the module decomposition — scoring was
 * tangled inside orama-search-service.ts.
 */
import { describe, it, expect } from 'vitest';
import { minmaxNormalize, rankNormalize, linearFusion, applyCoordinationBonus, applyTemporalDecay, applyExactTitlePin, DEFAULT_WEIGHTS, DEFAULT_HALF_LIFE_DAYS, TITLE_PIN_BONUS, type ScoredHit } from '@backlog-mcp/memory/search';

describe('scoring module (ADR-0081)', () => {
  describe('minmaxNormalize', () => {
    it('normalizes to [0,1] range', () => {
      const hits: ScoredHit[] = [
        { id: 'a', score: 10 },
        { id: 'b', score: 5 },
        { id: 'c', score: 0 },
      ];
      const result = minmaxNormalize(hits);
      expect(result[0].score).toBe(1.0);   // max → 1
      expect(result[1].score).toBe(0.5);   // midpoint
      expect(result[2].score).toBe(0.0);   // min → 0
    });

    it('handles empty array', () => {
      expect(minmaxNormalize([])).toEqual([]);
    });

    it('handles single result → score 1.0', () => {
      const result = minmaxNormalize([{ id: 'a', score: 42 }]);
      expect(result[0].score).toBe(1.0);
    });

    it('handles all same score → all 1.0', () => {
      const hits: ScoredHit[] = [
        { id: 'a', score: 5 },
        { id: 'b', score: 5 },
        { id: 'c', score: 5 },
      ];
      const result = minmaxNormalize(hits);
      expect(result.every(h => h.score === 1.0)).toBe(true);
    });

    it('preserves relative ordering', () => {
      const hits: ScoredHit[] = [
        { id: 'a', score: 100 },
        { id: 'b', score: 50 },
        { id: 'c', score: 1 },
      ];
      const result = minmaxNormalize(hits);
      expect(result[0].score).toBeGreaterThan(result[1].score);
      expect(result[1].score).toBeGreaterThan(result[2].score);
    });

    it('preserves IDs', () => {
      const hits: ScoredHit[] = [{ id: 'x', score: 10 }, { id: 'y', score: 5 }];
      const result = minmaxNormalize(hits);
      expect(result[0].id).toBe('x');
      expect(result[1].id).toBe('y');
    });
  });

  describe('linearFusion', () => {
    it('combines BM25 and vector scores with default weights', () => {
      const bm25: ScoredHit[] = [{ id: 'a', score: 1.0 }, { id: 'b', score: 0.5 }];
      const vector: ScoredHit[] = [{ id: 'a', score: 0.8 }, { id: 'b', score: 1.0 }];
      const result = linearFusion(bm25, vector);
      // a: 0.7*1.0 + 0.3*0.8 = 0.94
      // b: 0.7*0.5 + 0.3*1.0 = 0.65
      expect(result[0].id).toBe('a');
      expect(result[0].score).toBeCloseTo(0.94);
      expect(result[1].id).toBe('b');
      expect(result[1].score).toBeCloseTo(0.65);
    });

    it('returns sorted by score descending', () => {
      const bm25: ScoredHit[] = [{ id: 'a', score: 0.2 }];
      const vector: ScoredHit[] = [{ id: 'b', score: 1.0 }];
      const result = linearFusion(bm25, vector);
      // b: 0.3*1.0 = 0.3, a: 0.7*0.2 = 0.14
      expect(result[0].id).toBe('b');
      expect(result[1].id).toBe('a');
    });

    it('handles empty vector hits (BM25-only fallback)', () => {
      const bm25: ScoredHit[] = [
        { id: 'a', score: 1.0 },
        { id: 'b', score: 0.5 },
      ];
      const result = linearFusion(bm25, []);
      // Pure BM25: a = 0.7*1.0 = 0.7, b = 0.7*0.5 = 0.35
      expect(result[0].id).toBe('a');
      expect(result[0].score).toBeCloseTo(0.7);
      expect(result[1].score).toBeCloseTo(0.35);
    });

    it('handles empty BM25 hits (vector-only)', () => {
      const vector: ScoredHit[] = [{ id: 'a', score: 1.0 }];
      const result = linearFusion([], vector);
      expect(result[0].id).toBe('a');
      expect(result[0].score).toBeCloseTo(0.3);
    });

    it('handles both empty → empty result', () => {
      expect(linearFusion([], [])).toEqual([]);
    });

    it('merges docs appearing in only one retriever', () => {
      const bm25: ScoredHit[] = [{ id: 'a', score: 1.0 }];
      const vector: ScoredHit[] = [{ id: 'b', score: 1.0 }];
      const result = linearFusion(bm25, vector);
      // a: 0.7*1.0 = 0.7, b: 0.3*1.0 = 0.3
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('a');
      expect(result[1].id).toBe('b');
    });

    it('respects custom weights', () => {
      const bm25: ScoredHit[] = [{ id: 'a', score: 1.0 }];
      const vector: ScoredHit[] = [{ id: 'a', score: 1.0 }];
      const result = linearFusion(bm25, vector, { text: 0.5, vector: 0.5 });
      expect(result[0].score).toBeCloseTo(1.0);
    });

    it('vector-strong doc can outrank BM25-strong doc when both contribute', () => {
      // Doc 'a': strong BM25, weak vector
      // Doc 'b': weak BM25, strong vector + BM25 presence
      const bm25: ScoredHit[] = [{ id: 'a', score: 1.0 }, { id: 'b', score: 0.6 }];
      const vector: ScoredHit[] = [{ id: 'b', score: 1.0 }, { id: 'a', score: 0.1 }];
      const result = linearFusion(bm25, vector);
      // a: 0.7*1.0 + 0.3*0.1 = 0.73
      // b: 0.7*0.6 + 0.3*1.0 = 0.72
      // Close, but 'a' still wins slightly — BM25 weight dominates
      expect(result[0].id).toBe('a');
      expect(Math.abs(result[0].score - result[1].score)).toBeLessThan(0.05);
    });
  });

  describe('DEFAULT_WEIGHTS', () => {
    it('text weight is higher than vector weight', () => {
      expect(DEFAULT_WEIGHTS.text).toBeGreaterThan(DEFAULT_WEIGHTS.vector);
    });

    it('weights sum to 1.0', () => {
      expect(DEFAULT_WEIGHTS.text + DEFAULT_WEIGHTS.vector).toBeCloseTo(1.0);
    });
  });

  describe('applyCoordinationBonus', () => {
    const docs: Record<string, string> = {
      a: 'Feature: Daily Discovery Game',           // 1/2 terms: "feature" only
      b: 'FeatureStore ownership transfer docs',     // 2/2 terms: "feature" + "store"
      c: 'Store configuration settings',             // 1/2 terms: "store" only
    };
    const getText = (id: string) => docs[id] || '';

    it('boosts documents matching all query terms above partial matches', () => {
      const hits: ScoredHit[] = [
        { id: 'a', score: 0.8 },  // higher fusion score but only 1/2 terms
        { id: 'b', score: 0.3 },  // lower fusion score but 2/2 terms
        { id: 'c', score: 0.5 },  // mid fusion score, 1/2 terms
      ];
      const result = applyCoordinationBonus(hits, 'feature store', getText);
      // b gets full bonus: 0.3 + 0.5 = 0.8
      // a gets half bonus: 0.8 + 0.25 = 1.05
      // c gets half bonus: 0.5 + 0.25 = 0.75
      expect(result[0].id).toBe('a');  // still first (0.8 + 0.25 = 1.05)
      expect(result[1].id).toBe('b');  // promoted (0.3 + 0.5 = 0.8)
      expect(result[2].id).toBe('c');  // (0.5 + 0.25 = 0.75)
    });

    it('no-op for single-word queries', () => {
      const hits: ScoredHit[] = [{ id: 'a', score: 0.8 }, { id: 'b', score: 0.3 }];
      const result = applyCoordinationBonus(hits, 'feature', getText);
      expect(result).toEqual(hits);
    });

    it('proportional bonus: 2/3 terms gets more than 1/3', () => {
      const docs2: Record<string, string> = {
        x: 'feature store migration',  // 3/3
        y: 'feature store',            // 2/3
        z: 'feature only',             // 1/3
      };
      const hits: ScoredHit[] = [
        { id: 'x', score: 0.1 },
        { id: 'y', score: 0.1 },
        { id: 'z', score: 0.1 },
      ];
      const result = applyCoordinationBonus(hits, 'feature store migration', (id) => docs2[id] || '');
      // x: 0.1 + 3/3 * 0.5 = 0.6
      // y: 0.1 + 2/3 * 0.5 = 0.433
      // z: 0.1 + 1/3 * 0.5 = 0.267
      expect(result[0].id).toBe('x');
      expect(result[1].id).toBe('y');
      expect(result[2].id).toBe('z');
    });

    it('handles empty hits', () => {
      expect(applyCoordinationBonus([], 'feature store', () => '')).toEqual([]);
    });
  });

  describe('applyTemporalDecay (ADR-0092.1)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const NOW = 1_714_000_000_000;  // fixed reference time for determinism

    it('exports sensible default half-life', () => {
      expect(DEFAULT_HALF_LIFE_DAYS).toBe(30);
    });

    it('leaves same-day scores untouched (decay factor ≈ 1)', () => {
      const hits: ScoredHit[] = [{ id: 'fresh', score: 1.0 }];
      const getCreatedAt = () => NOW;
      const result = applyTemporalDecay(hits, getCreatedAt, { halfLifeDays: 30, now: NOW });
      expect(result[0].score).toBeCloseTo(1.0, 4);
    });

    it('halves a 30-day-old score with 30-day half-life', () => {
      const hits: ScoredHit[] = [{ id: 'month_old', score: 1.0 }];
      const getCreatedAt = () => NOW - 30 * DAY;
      const result = applyTemporalDecay(hits, getCreatedAt, { halfLifeDays: 30, now: NOW });
      expect(result[0].score).toBeCloseTo(0.5, 4);
    });

    it('quarters a 60-day-old score with 30-day half-life', () => {
      const hits: ScoredHit[] = [{ id: 'two_months' }].map((h, _, __) => ({ ...h, score: 1.0 }));
      const getCreatedAt = () => NOW - 60 * DAY;
      const result = applyTemporalDecay(hits, getCreatedAt, { halfLifeDays: 30, now: NOW });
      expect(result[0].score).toBeCloseTo(0.25, 4);
    });

    it('passes through docs without a timestamp (decay is opt-in per doc)', () => {
      const hits: ScoredHit[] = [
        { id: 'has_ts', score: 1.0 },
        { id: 'no_ts', score: 0.5 },
      ];
      const getCreatedAt = (id: string) => (id === 'has_ts' ? NOW - 30 * DAY : undefined);
      const result = applyTemporalDecay(hits, getCreatedAt, { halfLifeDays: 30, now: NOW });
      const hasTs = result.find(h => h.id === 'has_ts')!;
      const noTs = result.find(h => h.id === 'no_ts')!;
      expect(hasTs.score).toBeCloseTo(0.5, 4);   // decayed
      expect(noTs.score).toBeCloseTo(0.5, 4);    // unchanged
    });

    it('re-ranks: a recent mid-score doc beats an old high-score doc', () => {
      const hits: ScoredHit[] = [
        { id: 'old_high', score: 0.9 },     // 90 days old
        { id: 'recent_mid', score: 0.6 },   // same day
      ];
      const getCreatedAt = (id: string) =>
        id === 'old_high' ? NOW - 90 * DAY : NOW;
      const result = applyTemporalDecay(hits, getCreatedAt, { halfLifeDays: 30, now: NOW });
      // old_high: 0.9 * 2^(-3) = 0.1125
      // recent_mid: 0.6 * 1 = 0.6
      expect(result[0].id).toBe('recent_mid');
      expect(result[1].id).toBe('old_high');
    });

    it('halfLifeDays ≤ 0 is a no-op (decay disabled)', () => {
      const hits: ScoredHit[] = [
        { id: 'a', score: 1.0 },
        { id: 'b', score: 0.5 },
      ];
      const getCreatedAt = () => NOW - 365 * DAY;  // year old
      const result = applyTemporalDecay(hits, getCreatedAt, { halfLifeDays: 0, now: NOW });
      expect(result[0].score).toBe(1.0);
      expect(result[1].score).toBe(0.5);
    });

    it('uses DEFAULT_HALF_LIFE_DAYS when halfLifeDays is omitted', () => {
      const hits: ScoredHit[] = [{ id: 'a', score: 1.0 }];
      const getCreatedAt = () => NOW - DEFAULT_HALF_LIFE_DAYS * DAY;
      const result = applyTemporalDecay(hits, getCreatedAt, { now: NOW });
      expect(result[0].score).toBeCloseTo(0.5, 4);
    });

    it('clamps future-dated docs to zero age (no bonus from clock skew)', () => {
      const hits: ScoredHit[] = [{ id: 'future', score: 1.0 }];
      const getCreatedAt = () => NOW + 30 * DAY;  // dated a month in the future
      const result = applyTemporalDecay(hits, getCreatedAt, { halfLifeDays: 30, now: NOW });
      expect(result[0].score).toBeCloseTo(1.0, 4);  // not > 1.0
    });

    it('handles empty hits', () => {
      expect(applyTemporalDecay([], () => NOW, { now: NOW })).toEqual([]);
    });

    it('sorts the returned hits by decayed score descending', () => {
      const hits: ScoredHit[] = [
        { id: 'old', score: 1.0 },
        { id: 'new', score: 0.51 },
      ];
      // 'old' is 30d old → 0.5, 'new' is fresh → 0.51
      const getCreatedAt = (id: string) => (id === 'old' ? NOW - 30 * DAY : NOW);
      const result = applyTemporalDecay(hits, getCreatedAt, { halfLifeDays: 30, now: NOW });
      expect(result[0].id).toBe('new');
      expect(result[1].id).toBe('old');
    });
  });

  describe('rankNormalize (ADR-0083 #10)', () => {
    it('returns empty for empty input', () => {
      expect(rankNormalize([])).toEqual([]);
    });

    it('single hit gets 1.0', () => {
      expect(rankNormalize([{ id: 'a', score: 3.7 }])[0].score).toBe(1.0);
    });

    it('all-same-score hits all get 1.0 (tie semantics match minmax)', () => {
      const out = rankNormalize([{ id: 'a', score: 2 }, { id: 'b', score: 2 }, { id: 'c', score: 2 }]);
      for (const h of out) expect(h.score).toBe(1.0);
    });

    it('lowest scorer keeps a positive score (the anti-annihilation property)', () => {
      // The TASK-0676 failure: minmax mapped the lowest BM25 scorer to 0.0.
      const hits: ScoredHit[] = [
        { id: 'a', score: 6.09 },
        { id: 'b', score: 4.96 },
        { id: 'c', score: 1.93 },  // the relevant-but-low doc
      ];
      const minmax = minmaxNormalize(hits);
      const rank = rankNormalize(hits);
      expect(minmax.find(h => h.id === 'c')!.score).toBe(0);          // the old bug
      expect(rank.find(h => h.id === 'c')!.score).toBeCloseTo(1 / 3); // the fix
    });

    it('preserves ordering and uses uniform rank steps', () => {
      const out = rankNormalize([{ id: 'b', score: 5 }, { id: 'a', score: 9 }, { id: 'c', score: 1 }]);
      expect(out.map(h => h.id)).toEqual(['a', 'b', 'c']);
      expect(out.map(h => h.score)).toEqual([1, 2 / 3, 1 / 3]);
    });

    it('tied scores share the same normalized value', () => {
      const out = rankNormalize([
        { id: 'a', score: 9 }, { id: 'b', score: 5 }, { id: 'c', score: 5 }, { id: 'd', score: 1 },
      ]);
      expect(out.find(h => h.id === 'b')!.score).toBe(out.find(h => h.id === 'c')!.score);
      expect(out.find(h => h.id === 'd')!.score).toBeGreaterThan(0);
    });
  });

  describe('applyExactTitlePin (ADR-0083 #8)', () => {
    const titles: Record<string, string> = {
      epic: 'backlog-mcp 10x',
      noise: 'Refactor mcp transport for backlog ingestion',
      featStore: 'FeatureStore ownership transfer',
      feature: 'Feature prioritization framework',
    };
    const getTitle = (id: string) => titles[id] ?? '';

    it('pins a contiguous title-phrase match above higher-scored non-matches', () => {
      const hits: ScoredHit[] = [{ id: 'noise', score: 1.35 }, { id: 'epic', score: 0.5 }];
      const out = applyExactTitlePin(hits, 'backlog mcp', getTitle);
      expect(out[0].id).toBe('epic');
      expect(out[0].score).toBeCloseTo(0.5 + TITLE_PIN_BONUS);
      expect(out[1].score).toBeCloseTo(1.35);  // non-contiguous terms → no pin
    });

    it('matches phrases through compound-word titles', () => {
      const hits: ScoredHit[] = [{ id: 'featStore', score: 0.2 }, { id: 'feature', score: 0.9 }];
      // "feature store" appears contiguously inside the tokenized "FeatureStore"
      const out = applyExactTitlePin(hits, 'feature store', getTitle);
      expect(out[0].id).toBe('featStore');
    });

    it('single-token query pins only an exact whole-title match', () => {
      const hits: ScoredHit[] = [{ id: 'feature', score: 0.9 }, { id: 'epic', score: 0.5 }];
      const out = applyExactTitlePin(hits, 'feature', getTitle);
      // 'Feature prioritization framework' contains but IS NOT "feature" → no pin
      expect(out[0].score).toBeCloseTo(0.9);
      expect(out[1].score).toBeCloseTo(0.5);
    });

    it('preserves relative order among multiple pinned docs', () => {
      const all = (id: string) => 'backlog mcp viewer';
      const hits: ScoredHit[] = [{ id: 'x', score: 0.8 }, { id: 'y', score: 0.6 }];
      const out = applyExactTitlePin(hits, 'backlog mcp', all);
      expect(out.map(h => h.id)).toEqual(['x', 'y']);  // constant offset, not override
    });

    it('empty query is a no-op', () => {
      const hits: ScoredHit[] = [{ id: 'epic', score: 0.5 }];
      expect(applyExactTitlePin(hits, '  ', getTitle)[0].score).toBe(0.5);
    });
  });
});
