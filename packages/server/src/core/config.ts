/**
 * Per-repo config (ADR 0105) — resolves a default scope for memory & wakeup
 * from a `.backlog-mcp/` folder discovered by walking up from the cwd.
 *
 * Design (ADR 0105):
 *  - Pure & injectable. `cwd`, env, and filesystem readers are parameters, not
 *    ambient singletons — so this is memfs-testable and safe in a long-lived
 *    process (unlike PathResolver, which reads env once at construction).
 *  - A DEFAULT PROVIDER, never an override. Explicit caller input (a CLI flag /
 *    MCP param) always wins. Precedence, highest first:
 *        explicit  >  BACKLOG_SCOPE env  >  config.local.json  >  config.json
 *    Resolving to `undefined` reproduces today's whole-backlog behavior.
 *  - Graceful degradation. A malformed config file must never crash `wakeup`:
 *    parse/validation errors are swallowed (logged once) and the resolver falls
 *    through to the next precedence layer — same posture as the embedding
 *    service's BM25 fallback.
 *
 * Transport asymmetry (ADR 0105 "decisive asymmetry"): the config FILE is read
 * from cwd, which is reliable only for the in-process CLI. The detached, shared
 * MCP server has a different cwd, so it relies on the `BACKLOG_SCOPE` env layer
 * (set in the MCP client config, exactly like BACKLOG_DATA_DIR). This module
 * honors both via the single precedence order above.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const CONFIG_DIR = '.backlog-mcp';
export const CONFIG_FILE = 'config.json';
export const CONFIG_LOCAL_FILE = 'config.local.json';
export const SCOPE_ENV_VAR = 'BACKLOG_SCOPE';

/**
 * Repo config schema. `z.looseObject` keeps unknown keys so a newer config
 * (e.g. once dataDir/port migrate in — ADR 0105 follow-ups) doesn't break an
 * older parser. Every field is optional; an empty `{}` is valid.
 */
export const RepoConfigSchema = z.looseObject({
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

/**
 * Walk up from `startDir` to the filesystem root, returning the first
 * directory that contains a `.backlog-mcp/` folder, or undefined if none.
 */
export function findConfigDir(
  startDir: string,
  deps: ConfigFsDeps = realFs,
): string | undefined {
  let dir = startDir;
  // parsePath(dir).root is '/' (posix) — the loop terminates when dirname stops
  // changing (we've hit the root).
  for (;;) {
    if (deps.exists(join(dir, CONFIG_DIR))) return join(dir, CONFIG_DIR);
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached root
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
): RepoConfig {
  const configDir = findConfigDir(cwd, deps);
  if (!configDir) return {};
  const base = tryLoad(join(configDir, CONFIG_FILE), deps) ?? {};
  const local = tryLoad(join(configDir, CONFIG_LOCAL_FILE), deps) ?? {};
  return { ...base, ...local }; // local overrides committed
}

export interface ResolveScopeParams {
  /** Caller-supplied scope (CLI flag / MCP param). Wins over everything. */
  explicit?: string;
  /** Working directory to discover config from. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment map. Defaults to process.env. */
  env?: Record<string, string | undefined>;
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
  return clean(loadRepoConfig(cwd, params.deps).scope);
}
