import type { BacklogHomeSelector } from '../core/backlog-home.types.js';

/** Caller-scoped home selection extracted from one transport request. */
export interface LocalRuntimeRequestSelection {
  home?: string;
  projectRoot?: string;
}

/** Process-owned defaults that do not vary between callers. */
export interface LocalRuntimeRequestResolverOptions {
  globalRoot?: string;
}

/** Validated request selection before canonical home resolution. */
export interface ValidatedLocalRuntimeSelection {
  home: BacklogHomeSelector;
  projectRoot?: string;
}
