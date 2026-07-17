/**
 * Canonical read path (LATTICE W1, worktree-native charter, Idea A).
 *
 * Within a family there are two kinds of truth: the branch home (this
 * checkout's own files) and the CANONICAL home — the committed tree of
 * the family's default branch, read through git plumbing
 * (`git show <ref>:<path>`), never through another checkout's working
 * directory. Git IS the infrastructure: no server, no sync, no second
 * store (moat-map M1).
 *
 * Reads are deterministic and pinned: the ref is first resolved to a
 * commit SHA and content is read AT that SHA, so the returned
 * `{ content, commit }` pair is atomic — a concurrent branch move cannot
 * tear it. Objects come from the family's shared common dir, so running
 * inside any checkout of the family answers identically; nothing here
 * ever touches a sibling checkout's working directory. Committed
 * markdown is authoritative — a sibling's uncommitted working tree is
 * nobody's truth (NORTH-STAR law).
 *
 * Fail-open like every git adapter in this layer: missing git, unknown
 * ref, or a path absent from the commit returns undefined, never throws.
 */

import { runGitCommand, type GitRunner } from './git-runner.js';

/** One committed file, read at a pinned commit. */
export interface CanonicalFileRead {
  /** Exact blob content at `commit` (byte-faithful UTF-8, no trimming). */
  content: string;
  /** Full SHA of the commit the content was read from. */
  commit: string;
}

const FULL_SHA_PATTERN = /^[0-9a-f]{40,64}$/;

export interface ReadCanonicalFileParams {
  /**
   * Directory to run git in — any checkout of the family (typically the
   * current worktree root). The read resolves through the shared common
   * dir; no other checkout's working directory is involved.
   */
  cwd: string;
  /**
   * Ref to read from: the family's default branch name for canonical
   * truth, or a commit SHA for a pinned re-read.
   */
  ref: string;
  /** Repo-root-relative POSIX path of the committed file. */
  path: string;
  /** Injectable runner (tests, fail-open probes). */
  runGit?: GitRunner;
}

/**
 * Read one committed file's content from `ref`, pinned to the commit SHA
 * the ref resolved to. Deterministic and read-only; undefined when the
 * ref does not resolve or the path is not in that commit (fail-open).
 */
export function readCanonicalFile(
  params: ReadCanonicalFileParams,
): CanonicalFileRead | undefined {
  const runGit = params.runGit ?? runGitCommand;

  const commit = runGit(params.cwd, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${params.ref}^{commit}`,
  ])?.trim();
  if (commit === undefined || !FULL_SHA_PATTERN.test(commit)) return undefined;

  const content = runGit(params.cwd, ['show', `${commit}:${params.path}`]);
  if (content === undefined) return undefined;

  return { content, commit };
}
