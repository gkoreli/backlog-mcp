import type {
  BacklogHomeDeps,
  DiscoverProjectRootParams,
  ResolveBacklogHomeParams,
} from '../../core/backlog-home.types.js';

/** Local callers may omit process defaults and override filesystem capabilities. */
export type LocalHomeResolutionParams =
  Omit<ResolveBacklogHomeParams, 'cwd' | 'env'>
  & Partial<Pick<ResolveBacklogHomeParams, 'cwd' | 'env'>>
  & { deps?: Partial<BacklogHomeDeps> };

/** Filesystem-backed discovery with optional injected probes. */
export type LocalProjectRootParams = DiscoverProjectRootParams
  & { deps?: Partial<BacklogHomeDeps> };
