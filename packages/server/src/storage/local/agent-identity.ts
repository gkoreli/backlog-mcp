/**
 * Process binding for the attribution ladder (ADR 0119.1).
 *
 * The ladder itself is pure core logic (core/identity-resolution.ts);
 * this module — like git-family, and under the same law — is where the
 * real subprocess lives: it probes the git rungs through the injectable
 * runner seam ONCE per canonical runtime directory and caches the plain
 * result, so neither the CLI nor the server spawns git on a per-call hot
 * path. The environment rung is deliberately NOT cached: reading process.env is
 * free, and per-invocation env reads are the existing envActor contract.
 */

import {
  probeAgentIdentityGitRungs,
  resolveAgentIdentity,
  type AgentIdentityGitRungs,
  type ResolvedAgentIdentity,
} from '../../core/identity-resolution.js';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { runGitCommand, type GitRunner } from './git-runner.js';

const cachedGitRungsByDirectory = new Map<string, AgentIdentityGitRungs>();

function canonicalIdentityDirectory(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    // A missing/non-readable directory is still a valid fail-open probe:
    // normalize its spelling so repeated failures share one cache entry.
    return resolve(cwd);
  }
}

/** Test seam: probe sources overriding the ambient process defaults. */
export interface AmbientAgentIdentityOverrides {
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  runGit?: GitRunner;
}

/**
 * Resolve the ambient agent identity for one runtime directory: rungs 2–5
 * of the ladder (git rungs probed once per canonical directory, cached; env
 * read live). An explicit per-call identity (rung 1) is layered by callers —
 * `withAgentIdentity` / the MCP `as` field — exactly as before.
 */
export function ambientAgentIdentity(
  overrides?: AmbientAgentIdentityOverrides,
): ResolvedAgentIdentity | undefined {
  const cwd = overrides?.cwd ?? process.cwd();
  const directory = canonicalIdentityDirectory(cwd);
  let gitRungs = cachedGitRungsByDirectory.get(directory);
  if (gitRungs === undefined) {
    gitRungs = probeAgentIdentityGitRungs(
      directory,
      overrides?.runGit ?? runGitCommand,
    );
    cachedGitRungsByDirectory.set(directory, gitRungs);
  }
  return resolveAgentIdentity({
    gitRungs,
    env: overrides?.env ?? process.env,
  });
}

/** Drop the cached git rungs so the next call re-probes (tests only). */
export function resetAmbientAgentIdentityCacheForTests(): void {
  cachedGitRungsByDirectory.clear();
}
