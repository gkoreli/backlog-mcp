/**
 * Implicit identity capture — the attribution ladder (ADR 0119.1).
 *
 * Agent identity is workspace configuration, git-style: declared once at
 * the scope it belongs to, resolved per process through a precedence
 * ladder, and disclosed with its winning rung. The ladder, most
 * deliberate and most specific first:
 *
 *   1. explicit per-call        — CLI `--as`, MCP `as` field
 *   2. worktree config          — `git config --worktree backlog.agent`
 *                                 (requires extensions.worktreeConfig)
 *   3. environment              — `BACKLOG_AGENT`
 *   4. checkout config          — `git config --local backlog.agent`
 *   5. user config              — `git config --global backlog.agent`
 *   6. absent                   — identity stays OPTIONAL (PROMPT 0003)
 *
 * R1 — worktree beats environment. Env vars are inherited
 * indiscriminately by child processes; the worktree stamp is placed
 * deliberately, for that agent, at delegation time. This deviates from
 * git's own env-over-config precedence on purpose: the more deliberate
 * signal must win or first-person attribution (PROMPT 0006) breaks.
 *
 * This module is pure over plain data — core never shells out (ADR 0090
 * discipline; same law as git-family). The git rungs arrive as
 * already-probed values; the one probe rides the injectable git-runner
 * seam (LATTICE W1) and is bound to the real process by
 * `storage/local/agent-identity.ts`. Fail-open throughout: a non-git
 * home, an old git without `--show-scope` (< 2.26), or any failed probe
 * yields absent rungs, never an error.
 */

import type { GitRunner } from '../storage/local/git-runner.js';

/**
 * The winning rung, in the exact disclosure vocabulary of ADR 0119.1 R2:
 * the briefing's meta line prints `identity: <display> (<source>)`
 * verbatim, so misattribution is debuggable at a glance.
 */
export type AgentIdentitySource =
  | '--as'
  | 'worktree config'
  | 'env'
  | 'checkout config'
  | 'user config';

/** A resolved identity: the raw value plus the rung that supplied it. */
export interface ResolvedAgentIdentity {
  /** What `--as` accepts today: an AGENT- doc id or a declared principal. */
  value: string;
  source: AgentIdentitySource;
}

/** Plain-data probe result for the three git-config rungs (2, 4, 5). */
export interface AgentIdentityGitRungs {
  /** `git config --worktree backlog.agent` (extension-gated). */
  worktree?: string;
  /** `git config --local backlog.agent`. */
  checkout?: string;
  /** `git config --global backlog.agent`. */
  user?: string;
}

/**
 * Probe all three git rungs with ONE subprocess:
 * `git config --show-scope --get-all backlog.agent` tags every value
 * with its owning scope, and git itself enforces the
 * extensions.worktreeConfig gate — `config.worktree` is not consulted
 * at all when the extension is unset, so an ungated stamp can never
 * masquerade as rung 2 (verified against real repos in
 * identity-resolution.test.ts). Absent key, non-git cwd for the
 * repo-scoped rungs, missing binary, or an old git all surface as a
 * failed/empty probe → absent rungs (fail-open, never an error). The
 * global rung deliberately still resolves from a non-git cwd, exactly
 * like git's own identity.
 */
export function probeAgentIdentityGitRungs(
  cwd: string,
  runGit: GitRunner,
): AgentIdentityGitRungs {
  const output = runGit(cwd, [
    'config',
    '--show-scope',
    '--get-all',
    'backlog.agent',
  ]);
  if (output === undefined) return {};
  const rungs: AgentIdentityGitRungs = {};
  for (const line of output.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const scope = line.slice(0, tab);
    const value = line.slice(tab + 1).trim();
    // An empty value is an absent rung, not an empty identity.
    if (value === '') continue;
    // Later lines win within a scope (git's own last-one-wins), and
    // scopes outside the ladder (system, command) are not rungs.
    if (scope === 'worktree') rungs.worktree = value;
    else if (scope === 'local') rungs.checkout = value;
    else if (scope === 'global') rungs.user = value;
  }
  return rungs;
}

export interface AgentIdentityResolutionInput {
  /** Rung 1: the per-call override (`--as` / MCP `as`). */
  explicit?: string;
  /** Rungs 2/4/5, already probed (see probeAgentIdentityGitRungs). */
  gitRungs?: AgentIdentityGitRungs;
  /** Rung 3 source: the process environment (reads BACKLOG_AGENT). */
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Walk the ladder; first present rung wins. Returns the value AND the
 * winning rung so disclosure can name the source (R2), or undefined for
 * rung 6 — absent, honest, byte-identical to pre-0119.1 behavior.
 */
export function resolveAgentIdentity(
  input: AgentIdentityResolutionInput = {},
): ResolvedAgentIdentity | undefined {
  const explicit = input.explicit?.trim();
  if (explicit !== undefined && explicit !== '') {
    return { value: explicit, source: '--as' };
  }
  const rungs = input.gitRungs ?? {};
  // R1: the deliberate worktree stamp outranks the inherited environment.
  if (rungs.worktree !== undefined) {
    return { value: rungs.worktree, source: 'worktree config' };
  }
  const envIdentity = input.env?.['BACKLOG_AGENT']?.trim();
  if (envIdentity !== undefined && envIdentity !== '') {
    return { value: envIdentity, source: 'env' };
  }
  if (rungs.checkout !== undefined) {
    return { value: rungs.checkout, source: 'checkout config' };
  }
  if (rungs.user !== undefined) {
    return { value: rungs.user, source: 'user config' };
  }
  return undefined;
}
