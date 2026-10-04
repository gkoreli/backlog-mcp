/**
 * The one injectable git-plumbing seam for local composition adapters.
 *
 * Every git subprocess in the local layer runs through a `GitRunner` so
 * that (a) core never shells out — adapters build plain data and inject
 * it (ADR 0090 discipline, proven by git-recency), and (b) tests can
 * substitute a stub runner to prove fail-open behavior without uninstalling
 * git. A runner returns raw stdout on success and `undefined` on ANY
 * failure — missing binary, non-zero exit, not a repository — so callers
 * degrade to their no-git behavior instead of throwing.
 */

import { spawnSync } from 'node:child_process';
import type { GitRunner } from '../../core/git-runner.contract.js';

const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

/** The real subprocess-backed runner (fail-open, never throws). */
export const runGitCommand: GitRunner = function runGitCommand(cwd, args) {
  try {
    const result = spawnSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') {
      return undefined;
    }
    return result.stdout;
  } catch {
    return undefined;
  }
};
