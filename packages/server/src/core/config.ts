/** Per-repository caller defaults discovered from `.backlog/`. */

import { existsSync, readFileSync } from 'node:fs';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { z } from 'zod';
import type { BacklogHome } from './backlog-home.types.js';

export const CONFIG_DIR = '.backlog';
export const CONFIG_FILE = 'config.json';
export const CONFIG_LOCAL_FILE = 'config.local.json';
export const CONTEXT_ENV_VAR = 'BACKLOG_CONTEXT';
export const VCS_CONFIG_BOUNDARY = '.git';

/**
 * Home defaults keep home selection separate from entity-subtree context.
 * Unknown keys remain available to newer readers.
 */
export const RepoConfigSchema = z.looseObject({
  /** Default document universe for calls from this repository. */
  home: z.enum(['global', 'project']).optional(),
  /** Project documents directory, relative to the project root by default. */
  documentsDir: z.string().optional(),
  /** Default context container id (e.g. "FLDR-0001") for wakeup/recall/remember. */
  context: z.string().optional(),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

/** Injectable filesystem surface — defaults to real fs, overridable in tests. */
export interface ConfigFsDeps {
  exists: (path: string) => boolean;
  read: (path: string) => string;
}

const realFs: ConfigFsDeps = {
  exists: existsSync,
  read: (path) => readFileSync(path, 'utf-8'),
};

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath)
    );
}

/**
 * Find the nearest `.backlog/` without crossing the nearest VCS boundary
 * or an optional inclusive `stopDir`.
 */
export function findConfigDir(
  startDir: string,
  deps: ConfigFsDeps = realFs,
  stopDir?: string,
): string | undefined {
  let dir = resolve(startDir);
  const boundary = stopDir === undefined ? undefined : resolve(stopDir);
  if (boundary !== undefined && !isPathWithin(boundary, dir)) return undefined;

  for (;;) {
    if (deps.exists(join(dir, CONFIG_DIR))) return join(dir, CONFIG_DIR);
    if (deps.exists(join(dir, VCS_CONFIG_BOUNDARY))) return undefined;
    if (dir === boundary) return undefined;

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Parse one config file, swallowing read/parse/validation errors → undefined. */
function tryLoad(path: string, deps: ConfigFsDeps): RepoConfig | undefined {
  if (!deps.exists(path)) return undefined;
  try {
    const parsed = RepoConfigSchema.safeParse(JSON.parse(deps.read(path)));
    if (parsed.success) return parsed.data;
    console.error(`[config] ignoring invalid ${path}: ${parsed.error.message}`);
  } catch (err) {
    console.error(`[config] ignoring unreadable ${path}:`, err);
  }
  return undefined;
}

/**
 * Load the merged repo config (config.local.json overlaid on config.json).
 * Returns `{}` when no `.backlog/` exists or both files are absent/invalid.
 */
export function loadRepoConfig(
  cwd: string,
  deps: ConfigFsDeps = realFs,
  stopDir?: string,
): RepoConfig {
  const configDir = findConfigDir(cwd, deps, stopDir);
  if (!configDir) return {};
  const base = tryLoad(join(configDir, CONFIG_FILE), deps) ?? {};
  const local = tryLoad(join(configDir, CONFIG_LOCAL_FILE), deps) ?? {};
  return { ...base, ...local };
}

/**
 * Load one resolved home's configuration.
 *
 * Project homes merge the committed base with a machine-local override.
 * The private global home has one flat config file and no collaboration layer.
 */
export function loadHomeConfig(
  home: BacklogHome,
  deps: ConfigFsDeps = realFs,
): RepoConfig {
  const base = tryLoad(join(home.controlDir, CONFIG_FILE), deps) ?? {};
  if (home.kind === 'global') return base;
  const local = tryLoad(join(home.controlDir, CONFIG_LOCAL_FILE), deps) ?? {};
  return { ...base, ...local };
}

export interface ResolveContextParams {
  /** Caller-supplied context (CLI flag / MCP param). Wins over everything. */
  explicit?: string;
  /** Working directory to discover config from. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment map. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Inclusive upper discovery boundary. */
  stopDir?: string;
  deps?: ConfigFsDeps;
  /** Resolved home when its config file should be read directly. */
  home?: BacklogHome;
  /**
   * Ambient config fallback (home/repo config). Cross-home reads pass
   * false: with several homes in one read there is no single ambient
   * scope, and stamping the caller repo's scope onto every home filters
   * foreign homes to zero (TASK-0006). Defaults to true.
   */
  ambient?: boolean;
}

/**
 * Resolve the effective default context per ADR 0112.3 precedence:
 *   explicit > BACKLOG_CONTEXT env > home config > undefined
 *
 * A blank/whitespace-only value at any layer is treated as absent so an empty
 * env export or `"context": ""` doesn't shadow a lower layer.
 *
 * `ambient: false` stops after the env layer — used by cross-home reads,
 * where no single home's or repo's ambient scope may speak for all homes.
 */
export function resolveContext(
  params: ResolveContextParams = {},
): string | undefined {
  const clean = (v: string | undefined): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };

  const explicit = clean(params.explicit);
  if (explicit) return explicit;

  const env = params.env ?? process.env;
  const fromEnv = clean(env[CONTEXT_ENV_VAR]);
  if (fromEnv) return fromEnv;

  if (params.ambient === false) return undefined;

  if (params.home !== undefined) {
    return clean(loadHomeConfig(params.home, params.deps).context);
  }
  const cwd = params.cwd ?? process.cwd();
  return clean(loadRepoConfig(cwd, params.deps, params.stopDir).context);
}
