/**
 * Process binding for the attribution ladder (ADR 0119.1).
 *
 * The ladder itself is pure core logic (core/identity-resolution.ts);
 * this module — like git-family, and under the same law — is where the
 * real subprocess lives: it probes the git rungs through the injectable
 * runner seam ONCE per process and caches the plain result, so neither
 * the CLI nor the server ever spawns git on a per-call hot path. The
 * environment rung is deliberately NOT cached: reading process.env is
 * free, and per-invocation env reads are the existing envActor contract.
 */

import {
  probeAgentIdentityGitRungs,
  resolveAgentIdentity,
  type AgentIdentityGitRungs,
  type ResolvedAgentIdentity,
} from '../../core/identity-resolution.js';
import { runGitCommand, type GitRunner } from './git-runner.js';

let cachedGitRungs: AgentIdentityGitRungs | undefined;

/** Test seam: probe sources overriding the ambient process defaults. */
export interface AmbientAgentIdentityOverrides {
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  runGit?: GitRunner;
}

/**
 * Resolve the ambient agent identity for THIS process: rungs 2–5 of the
 * ladder (git rungs probed once, cached; env read live). An explicit
 * per-call identity (rung 1) is layered by callers that have one —
 * `withAgentIdentity` / the MCP `as` field — exactly as before.
 */
export function ambientAgentIdentity(
  overrides?: AmbientAgentIdentityOverrides,
): ResolvedAgentIdentity | undefined {
  if (cachedGitRungs === undefined) {
    cachedGitRungs = probeAgentIdentityGitRungs(
      overrides?.cwd ?? process.cwd(),
      overrides?.runGit ?? runGitCommand,
    );
  }
  return resolveAgentIdentity({
    gitRungs: cachedGitRungs,
    env: overrides?.env ?? process.env,
  });
}

/** Drop the cached git rungs so the next call re-probes (tests only). */
export function resetAmbientAgentIdentityCacheForTests(): void {
  cachedGitRungs = undefined;
}
