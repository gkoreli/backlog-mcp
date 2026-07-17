/**
 * Git worktree family resolution (LATTICE W1, worktree-native charter).
 *
 * A family is a repo plus all its worktrees, identified by the git common
 * dir. This adapter answers one question for home resolution: is this
 * project root a LINKED worktree (its `.git` is a `gitdir: …` pointer
 * file), and if so which family does it belong to — the main checkout
 * root, the branch checked out here, and the family's default branch.
 * Main checkouts and non-git directories resolve to no family: a main
 * checkout IS its family root, so nothing changes for them.
 *
 * Same law as git-recency: this lives OUTSIDE core — compositions inject
 * `resolveGitFamily` through the home-resolution dependency object and
 * core attaches the returned plain data; core never shells out. Every
 * probe goes through the injectable runner — the pointer file itself is
 * detected via plumbing (`--git-dir` differs from `--git-common-dir`
 * exactly when the root is a linked worktree), so the adapter needs no
 * filesystem access of its own.
 *
 * Fail-open throughout: git missing or too old for `--path-format`
 * (< 2.31), an unexpected layout (bare common dir), a detached HEAD, or
 * any failed probe returns undefined, and home resolution behaves exactly
 * as it did before this module existed.
 */

import { basename, dirname } from 'node:path';
import type { BacklogHomeFamily } from '../../core/backlog-home.types.js';
import { runGitCommand, type GitRunner } from './git-runner.js';

/** Local default-branch fallbacks when origin/HEAD is not configured. */
const DEFAULT_BRANCH_CANDIDATES = ['main', 'master'] as const;

function branchExists(cwd: string, branch: string, runGit: GitRunner): boolean {
  return runGit(cwd, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ]) !== undefined;
}

/**
 * The family's default branch, as a LOCAL branch name that verifiably
 * exists (worktrees share refs through the common dir): origin/HEAD's
 * short name when it resolves locally, else the first of main/master.
 */
function resolveDefaultBranch(
  cwd: string,
  runGit: GitRunner,
): string | undefined {
  const originHead = runGit(cwd, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ])?.trim();
  if (originHead !== undefined && originHead !== '') {
    const slash = originHead.indexOf('/');
    const name = slash > 0 ? originHead.slice(slash + 1) : originHead;
    if (branchExists(cwd, name, runGit)) return name;
  }
  return DEFAULT_BRANCH_CANDIDATES.find(
    candidate => branchExists(cwd, candidate, runGit),
  );
}

/**
 * Resolve the git family of one project root. Returns plain data for a
 * LINKED worktree only; undefined for main checkouts, non-git roots,
 * detached HEADs, and every failure mode (fail-open, never throws).
 */
export function resolveGitFamily(
  projectRoot: string,
  runGit: GitRunner = runGitCommand,
): BacklogHomeFamily | undefined {
  // One probe answers "linked worktree?" and "which family?" together:
  // a linked worktree's git dir (…/.git/worktrees/<name>) differs from
  // the family's common dir (…/.git); a main checkout's are identical.
  const dirs = runGit(projectRoot, [
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
    '--git-common-dir',
  ]);
  if (dirs === undefined) return undefined;
  const [gitDir, commonDir] = dirs.trim().split('\n').map(line => line.trim());
  if (!gitDir || !commonDir || gitDir === commonDir) return undefined;

  // The common dir is the family identity; its parent is the main
  // checkout root. A common dir not named `.git` (e.g. a bare repository)
  // has no main checkout to call home — fail open.
  if (basename(commonDir) !== '.git') return undefined;
  const familyRoot = dirname(commonDir);

  const branch = runGit(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  if (branch === undefined || branch === '' || branch === 'HEAD') return undefined;

  const defaultBranch = resolveDefaultBranch(projectRoot, runGit);
  if (defaultBranch === undefined) return undefined;

  return {
    root: familyRoot,
    name: basename(familyRoot),
    branch,
    defaultBranch,
  };
}

/**
 * Commits on `ref` that HEAD lacks — how far this checkout sits behind
 * the family's default branch (`git rev-list --count HEAD..<ref>`).
 * Undefined when git is unavailable or the range cannot be resolved.
 */
export function countCommitsBehind(
  cwd: string,
  ref: string,
  runGit: GitRunner = runGitCommand,
): number | undefined {
  const output = runGit(cwd, ['rev-list', '--count', `HEAD..${ref}`])?.trim();
  if (output === undefined || !/^\d+$/.test(output)) return undefined;
  return Number.parseInt(output, 10);
}
