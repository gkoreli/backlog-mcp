import type { BacklogHome } from '../../core/backlog-home.types.js';
import type { LocalRuntime } from './local-runtime.js';

/** Construct one unstarted local runtime for a canonical backlog home. */
export type LocalRuntimeFactory = (home: BacklogHome) => LocalRuntime;
