/** Caller home-selection inputs and their validated form (ADR 0112 R-2, R-8). */
import type { BacklogHomeSelector } from './backlog-home.types.js';

/** Home selection as a caller supplied it: flags, headers, or query parameters. */
export interface HomeSelectionRequest {
  home?: string;
  projectRoot?: string;
}

/** A home selection that is internally consistent, before canonical resolution. */
export interface ValidatedHomeSelection {
  home: BacklogHomeSelector;
  projectRoot?: string;
}
