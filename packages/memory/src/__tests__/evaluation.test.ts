import { describe, expect, it } from 'vitest';
import {
  evaluateQuery,
  ndcgAt,
  recallAt,
  reciprocalRank,
  successAt1,
  summarizeEvaluations,
  type RelevanceJudgment,
} from '../search/evaluation.js';

const JUDGMENTS: RelevanceJudgment[] = [
  { id: 'A', grade: 3 },
  { id: 'B', grade: 2 },
  { id: 'C', grade: 1 },
  { id: 'D', grade: 0 },
];

describe('ranked retrieval evaluation', () => {
  it('gives an ideal graded ranking nDCG 1', () => {
    expect(ndcgAt(['A', 'B', 'C', 'D'], JUDGMENTS, 10)).toBe(1);
  });

  it('penalizes relevant documents ranked below weaker judgments', () => {
    expect(ndcgAt(['D', 'C', 'B', 'A'], JUDGMENTS, 10)).toBeCloseTo(0.5478, 4);
  });

  it('uses grade 2 as the binary relevance threshold', () => {
    const ranked = ['C', 'D', 'B', 'A'];
    expect(reciprocalRank(ranked, JUDGMENTS)).toBe(1 / 3);
    expect(successAt1(ranked, JUDGMENTS)).toBe(0);
    expect(recallAt(ranked, JUDGMENTS, 3)).toBe(0.5);
  });

  it('deduplicates retrieved ids when computing recall', () => {
    expect(recallAt(['A', 'A', 'B'], JUDGMENTS, 20)).toBe(1);
  });

  it('returns zero for empty or non-relevant judgment sets', () => {
    const nonRelevant: RelevanceJudgment[] = [{ id: 'X', grade: 1 }];
    expect(ndcgAt([], JUDGMENTS, 10)).toBe(0);
    expect(reciprocalRank([], JUDGMENTS)).toBe(0);
    expect(successAt1([], JUDGMENTS)).toBe(0);
    expect(recallAt(['X'], nonRelevant, 20)).toBe(0);
  });

  it('evaluates and macro-averages queries deterministically', () => {
    const ideal = evaluateQuery(['A', 'B', 'C'], JUDGMENTS);
    const missed = evaluateQuery(['D', 'C'], JUDGMENTS);
    const summary = summarizeEvaluations([ideal, missed]);

    expect(ideal).toEqual({
      ndcgAt10: 1,
      reciprocalRank: 1,
      successAt1: 1,
      recallAt20: 1,
    });
    expect(summary.queryCount).toBe(2);
    expect(summary.ndcgAt10).toBeCloseTo((1 + ndcgAt(['D', 'C'], JUDGMENTS, 10)) / 2);
    expect(summary.reciprocalRank).toBe(0.5);
    expect(summary.successAt1).toBe(0.5);
    expect(summary.recallAt20).toBe(0.5);
  });

  it('returns a stable zero summary for no queries', () => {
    expect(summarizeEvaluations([])).toEqual({
      queryCount: 0,
      ndcgAt10: 0,
      reciprocalRank: 0,
      successAt1: 0,
      recallAt20: 0,
    });
  });
});
