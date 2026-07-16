/**
 * Deterministic ranked-retrieval metrics for judged search fixtures.
 *
 * Relevance grades follow the fixture's 0–3 scale. A grade of 2 or higher is
 * considered relevant for binary metrics (MRR, success, and recall), while
 * nDCG preserves the full graded signal.
 */

export type RelevanceGrade = 0 | 1 | 2 | 3;

export interface RelevanceJudgment {
  id: string;
  grade: RelevanceGrade;
}

export interface QueryEvaluation {
  ndcgAt10: number;
  reciprocalRank: number;
  successAt1: number;
  recallAt20: number;
}

export interface EvaluationSummary extends QueryEvaluation {
  queryCount: number;
}

export const DEFAULT_MAXIMUM_REGRESSION = 0.02;

const RELEVANT_GRADE = 2;

function gain(grade: RelevanceGrade): number {
  return Math.pow(2, grade) - 1;
}

function discountedCumulativeGain(grades: RelevanceGrade[]): number {
  return grades.reduce<number>((total, grade, index) => (
    total + gain(grade) / Math.log2(index + 2)
  ), 0);
}

function judgmentMap(judgments: readonly RelevanceJudgment[]): Map<string, RelevanceGrade> {
  return new Map(judgments.map(judgment => [judgment.id, judgment.grade]));
}

function uniqueRankedIds(rankedIds: readonly string[], cutoff: number): string[] {
  return [...new Set(rankedIds)].slice(0, cutoff);
}

/** Compute nDCG at a cutoff, retaining the fixture's graded signal. */
export function ndcgAt(
  rankedIds: readonly string[],
  judgments: readonly RelevanceJudgment[],
  cutoff: number,
): number {
  const byId = judgmentMap(judgments);
  const observed = uniqueRankedIds(rankedIds, cutoff)
    .map(id => byId.get(id) ?? 0);
  const ideal = judgments
    .map(judgment => judgment.grade)
    .sort((a, b) => b - a)
    .slice(0, cutoff);
  const idealDcg = discountedCumulativeGain(ideal);
  if (idealDcg === 0) return 0;
  return discountedCumulativeGain(observed) / idealDcg;
}

/** Return the reciprocal rank of the first grade-2-or-higher result. */
export function reciprocalRank(
  rankedIds: readonly string[],
  judgments: readonly RelevanceJudgment[],
  cutoff: number = rankedIds.length,
): number {
  const byId = judgmentMap(judgments);
  const firstRelevant = uniqueRankedIds(rankedIds, cutoff)
    .findIndex(id => (byId.get(id) ?? 0) >= RELEVANT_GRADE);
  return firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1);
}

/** Return 1 when the first result is grade 2 or higher, otherwise 0. */
export function successAt1(
  rankedIds: readonly string[],
  judgments: readonly RelevanceJudgment[],
): number {
  const first = rankedIds[0];
  if (first === undefined) return 0;
  return (judgmentMap(judgments).get(first) ?? 0) >= RELEVANT_GRADE ? 1 : 0;
}

/** Compute recall at a cutoff over all grade-2-or-higher judged documents. */
export function recallAt(
  rankedIds: readonly string[],
  judgments: readonly RelevanceJudgment[],
  cutoff: number,
): number {
  const relevant = new Set(
    judgments
      .filter(judgment => judgment.grade >= RELEVANT_GRADE)
      .map(judgment => judgment.id),
  );
  if (relevant.size === 0) return 0;
  const retrieved = new Set(uniqueRankedIds(rankedIds, cutoff).filter(id => relevant.has(id)));
  return retrieved.size / relevant.size;
}

/**
 * Report what fraction of a result window has no human judgment.
 *
 * Explicit grade 0 remains judged and is therefore distinct from an unknown
 * document that is absent from the qrels.
 */
export function unjudgedRateAt(
  rankedIds: readonly string[],
  judgments: readonly RelevanceJudgment[],
  cutoff: number,
): number {
  const judgedIds = new Set(judgments.map(judgment => judgment.id));
  const window = uniqueRankedIds(rankedIds, cutoff);
  if (window.length === 0) return 0;
  return window.filter(id => !judgedIds.has(id)).length / window.length;
}

/** Return whether a metric remains within the frozen absolute regression budget. */
export function isWithinRegressionBudget(
  current: number,
  reference: number,
  maximumRegression: number = DEFAULT_MAXIMUM_REGRESSION,
): boolean {
  return current >= reference - maximumRegression;
}

/** Evaluate one ranked result list using the ADR 0116 Phase 0 metrics. */
export function evaluateQuery(
  rankedIds: readonly string[],
  judgments: readonly RelevanceJudgment[],
): QueryEvaluation {
  return {
    ndcgAt10: ndcgAt(rankedIds, judgments, 10),
    reciprocalRank: reciprocalRank(rankedIds, judgments, 10),
    successAt1: successAt1(rankedIds, judgments),
    recallAt20: recallAt(rankedIds, judgments, 20),
  };
}

/**
 * Macro-average query evaluations so every judged information need has equal
 * weight regardless of how many relevant documents it contains.
 */
export function summarizeEvaluations(
  evaluations: readonly QueryEvaluation[],
): EvaluationSummary {
  if (evaluations.length === 0) {
    return {
      queryCount: 0,
      ndcgAt10: 0,
      reciprocalRank: 0,
      successAt1: 0,
      recallAt20: 0,
    };
  }

  const totals = evaluations.reduce<QueryEvaluation>((sum, evaluation) => ({
    ndcgAt10: sum.ndcgAt10 + evaluation.ndcgAt10,
    reciprocalRank: sum.reciprocalRank + evaluation.reciprocalRank,
    successAt1: sum.successAt1 + evaluation.successAt1,
    recallAt20: sum.recallAt20 + evaluation.recallAt20,
  }), {
    ndcgAt10: 0,
    reciprocalRank: 0,
    successAt1: 0,
    recallAt20: 0,
  });

  return {
    queryCount: evaluations.length,
    ndcgAt10: totals.ndcgAt10 / evaluations.length,
    reciprocalRank: totals.reciprocalRank / evaluations.length,
    successAt1: totals.successAt1 / evaluations.length,
    recallAt20: totals.recallAt20 / evaluations.length,
  };
}
