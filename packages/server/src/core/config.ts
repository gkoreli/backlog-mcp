/** Per-repository caller defaults discovered from `.backlog-mcp/`. */

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

export const CONFIG_DIR = '.backlog-mcp';
export const CONFIG_FILE = 'config.json';
export const CONFIG_LOCAL_FILE = 'config.local.json';
export const SCOPE_ENV_VAR = 'BACKLOG_SCOPE';
export const VCS_CONFIG_BOUNDARY = '.git';

/**
 * Repository defaults keep home selection separate from entity-subtree scope.
 * Unknown keys remain available to newer readers.
 */
export const RepoConfigSchema = z.looseObject({
  /** Default document universe for calls from this repository. */
  home: z.enum(['global', 'project']).optional(),
  /** Project documents directory, relative to the project root by default. */
  documentsDir: z.string().optional(),
  /** Default scope container id (e.g. "FLDR-0001") for wakeup/recall/remember. */
  scope: z.string().optional(),
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
 * Find the nearest `.backlog-mcp/` without crossing the nearest VCS boundary
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
 * Returns `{}` when no `.backlog-mcp/` exists or both files are absent/invalid.
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

export interface ResolveScopeParams {
  /** Caller-supplied scope (CLI flag / MCP param). Wins over everything. */
  explicit?: string;
  /** Working directory to discover config from. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment map. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Inclusive upper discovery boundary. */
  stopDir?: string;
  deps?: ConfigFsDeps;
}

/**
 * Resolve the effective default scope per ADR 0105 precedence:
 *   explicit > BACKLOG_SCOPE env > config.local.json > config.json > undefined
 *
 * A blank/whitespace-only value at any layer is treated as absent so an empty
 * env export or `"scope": ""` doesn't shadow a lower layer.
 */
export function resolveScope(params: ResolveScopeParams = {}): string | undefined {
  const clean = (v: string | undefined): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };

  const explicit = clean(params.explicit);
  if (explicit) return explicit;

  const env = params.env ?? process.env;
  const fromEnv = clean(env[SCOPE_ENV_VAR]);
  if (fromEnv) return fromEnv;

  const cwd = params.cwd ?? process.cwd();
  return clean(loadRepoConfig(cwd, params.deps, params.stopDir).scope);
}
