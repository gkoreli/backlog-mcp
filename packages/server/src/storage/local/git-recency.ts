/**
 * Git-backed observed recency (first-impression charter, Slice B stage 2).
 *
 * The smallest local adapter that answers one question: when was each
 * documents-dir file last touched by a commit? One `git log` subprocess,
 * newest-first; the first time a path appears is its last-commit date.
 *
 * This lives OUTSIDE core by law — the Node composition builds a plain
 * `sourcePath → ISO date` map and injects data; core never shells out.
 * The map orders disclosed evidence only: commit text, authors, and diffs
 * are never read, never surfaced, never turned into a substrate.
 *
 * Staging verdict (recorded in the charter): frontmatter-only replay of
 * the Aime timestamp-less ADR corpus selected the oldest IDs (0001, 0004,
 * 0006, 0007, 0008 — the exact B-2 reproduction); the injected git map
 * flipped selection to the newest applicable decisions including the
 * current accepted execution plan ADR-0027. Working-tree mtimes also
 * changed the selection but with checkout-time noise (surfaced 0009/0025,
 * missed 0027), so git is the source and mtime only covers untracked files.
 */

import { runGitCommand } from './git-runner.js';

const ENTRY_SEPARATOR = '\u0001';
/**
 * Last-commit ISO date per file beneath `documentsDir`, keyed by
 * documents-dir-relative POSIX path. Returns an empty map when git is
 * unavailable, the directory is not inside a work tree, or the log is
 * unreadable — recency then degrades to the caller's fallback, never throws.
 */
export function buildGitRecencyMap(
  documentsDir: string,
): Record<string, string> {
  const prefix = runGitCommand(documentsDir, ['rev-parse', '--show-prefix']);
  if (prefix === undefined) return {};
  const normalizedPrefix = prefix.trim();

  const log = runGitCommand(documentsDir, [
    'log',
    '--pretty=format:%x01%cI',
    '--name-only',
    '--',
    '.',
  ]);
  if (log === undefined) return {};

  const map: Record<string, string> = {};
  for (const entry of log.split(ENTRY_SEPARATOR)) {
    const lines = entry.split('\n');
    const isoDate = lines[0]?.trim();
    if (!isoDate) continue;
    for (const line of lines.slice(1)) {
      const repoPath = line.trim();
      if (repoPath === '' || !repoPath.startsWith(normalizedPrefix)) continue;
      const sourcePath = repoPath.slice(normalizedPrefix.length);
      if (sourcePath === '' || map[sourcePath] !== undefined) continue;
      map[sourcePath] = isoDate;
    }
  }
  return map;
}
