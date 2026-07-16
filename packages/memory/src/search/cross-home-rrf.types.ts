/**
 * One final, already-ranked result list from a selected home.
 *
 * Array position is the authoritative within-home ordinal rank. Items remain
 * opaque so the same merger can serve search and memory recall.
 */
export interface CrossHomeRankedList<T> {
  homeId: string;
  items: readonly T[];
}

/**
 * A cross-home result with its rank-fusion provenance.
 */
export interface CrossHomeRrfResult<T> {
  item: T;
  homeId: string;
  withinHomeRank: number;
  rrfScore: number;
}
