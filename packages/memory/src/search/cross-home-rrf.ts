import type {
  CrossHomeRankedList,
  CrossHomeRrfResult,
} from './cross-home-rrf.types.js';

export const RRF_K = 60;

interface SortableRrfResult<T> extends CrossHomeRrfResult<T> {
  localId: string;
}

function compareBytewise(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRrfResults<T>(
  left: SortableRrfResult<T>,
  right: SortableRrfResult<T>,
): number {
  const scoreDifference = right.rrfScore - left.rrfScore;
  if (scoreDifference !== 0) return scoreDifference;

  const homeDifference = compareBytewise(left.homeId, right.homeId);
  if (homeDifference !== 0) return homeDifference;

  return compareBytewise(left.localId, right.localId);
}

function completeCutoffTier<T>(
  results: readonly SortableRrfResult<T>[],
  limit: number,
): readonly SortableRrfResult<T>[] {
  const pageSize = Math.floor(limit);
  if (pageSize <= 0) return [];
  if (pageSize >= results.length) return results;

  const cutoff = results[pageSize - 1];
  if (cutoff === undefined) return [];

  let end = pageSize;
  while (end < results.length && results[end]?.rrfScore === cutoff.rrfScore) {
    end += 1;
  }
  return results.slice(0, end);
}

function toPublicResult<T>(
  result: SortableRrfResult<T>,
): CrossHomeRrfResult<T> {
  return {
    item: result.item,
    homeId: result.homeId,
    withinHomeRank: result.withinHomeRank,
    rrfScore: result.rrfScore,
  };
}

/**
 * Merge final within-home rankings with reciprocal-rank fusion.
 *
 * Raw item scores are deliberately ignored. Equal-score cutoff tiers are
 * returned whole; because a home contributes at most one item at each ordinal
 * rank, completing a tier adds at most one result per selected home.
 */
export function mergeCrossHomeRrf<T>(
  homeLists: readonly CrossHomeRankedList<T>[],
  limit: number,
  getLocalId: (item: T) => string,
): CrossHomeRrfResult<T>[] {
  if (limit <= 0) return [];

  const results: SortableRrfResult<T>[] = [];
  for (const { homeId, items } of homeLists) {
    for (const [index, item] of items.entries()) {
      const withinHomeRank = index + 1;
      results.push({
        item,
        homeId,
        withinHomeRank,
        rrfScore: 1 / (RRF_K + withinHomeRank),
        localId: getLocalId(item),
      });
    }
  }

  results.sort(compareRrfResults);
  return completeCutoffTier(results, limit).map(toPublicResult);
}
