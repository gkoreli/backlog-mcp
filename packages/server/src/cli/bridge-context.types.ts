import type {
  BacklogHomeDeps,
  BacklogHomeSelector,
} from '../core/backlog-home.types.js';

/** Caller-scoped home identity forwarded by the stdio bridge. */
export type BridgeHomeContext =
  | {
    readonly home: 'global';
  }
  | {
    readonly home: 'project';
    readonly projectRoot: string;
  };

/** Inputs used to resolve one bridge process's caller-scoped home. */
export interface ResolveBridgeHomeContextParams {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  home?: BacklogHomeSelector;
  projectRoot?: string;
  deps?: BacklogHomeDeps;
}
