/** Local configuration entrypoints preserve caller defaults while core requires read ports. */
import { existsSync, readFileSync } from 'node:fs';
import {
  findConfigDir as findWith,
  loadRepoConfig as loadRepoWith,
  loadHomeConfig as loadHomeWith,
  resolveContext as resolveWith,
  type ConfigFsDeps,
  type ConfigReadIssue,
  type ResolveContextParams,
} from '../../core/config.js';
import type { BacklogHome } from '../../core/backlog-home.types.js';

export { CONFIG_DIR, CONFIG_FILE, CONFIG_LOCAL_FILE, CONTEXT_ENV_VAR, VCS_CONFIG_BOUNDARY, RepoConfigSchema } from '../../core/config.js';
export type { RepoConfig, ConfigFsDeps } from '../../core/config.js';
export type LocalResolveContextParams = Omit<ResolveContextParams, 'cwd' | 'env' | 'deps'> & Partial<Pick<ResolveContextParams, 'cwd' | 'env' | 'deps'>>;
const LOCAL_READS: ConfigFsDeps = { reportIssue: reportConfigIssue, exists: existsSync, read: function read(path) { return readFileSync(path, 'utf8'); } };

/** Discover using local reads unless an explicit caller supplies another read port. */
export function findConfigDir(startDir: string, deps = LOCAL_READS, stopDir?: string) {
  return findWith(startDir, deps, stopDir);
}
/** Merge committed and local configuration through the pure policy. */
export function loadRepoConfig(cwd: string, deps = LOCAL_READS, stopDir?: string) {
  return loadRepoWith(cwd, deps, stopDir);
}
/** Read the selected home's config, retaining global/project merge semantics. */
export function loadHomeConfig(home: BacklogHome, deps = LOCAL_READS) {
  return loadHomeWith(home, deps);
}
/** Sample ambient caller defaults at the local boundary, never inside core. */
export function resolveContext(params: LocalResolveContextParams = {}) {
  return resolveWith({ ...params, cwd: params.cwd ?? process.cwd(), env: params.env ?? process.env, deps: params.deps ?? LOCAL_READS });
}

/** Preserve local diagnostics while domain callers can capture them as data. */
export function reportConfigIssue(issue: ConfigReadIssue): void {
  if (issue.kind === 'invalid') console.error(`[config] ignoring invalid ${issue.path}: ${issue.message}`);
  else console.error(`[config] ignoring unreadable ${issue.path}:`, issue.cause ?? issue.message);
}
