import { readFileSync, statSync } from 'node:fs';
import { paths } from '../utils/paths.js';

/** The conventional stdin marker (`gh --body-file -`, `git commit -F -`). */
export const STDIN_MARKER = '-';

/** Read all of stdin as UTF-8. */
export async function readStdin(
  stream: AsyncIterable<string | Uint8Array> = process.stdin,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Read a body file the way `gh issue create --body-file` does
 * (cli/cli `pkg/cmdutil/file_input.go`): `-` reads stdin, anything else is a
 * path the invoking user can read, relative to their cwd, `~` expanded.
 *
 * No home containment here, on purpose. The CLI runs as the user, who can
 * already `--content "$(cat any-file)"`. Containment belongs to the shared
 * server resolver, where a request-supplied path is a capability
 * (ADR 0112 R-2). File-to-content resolution is a local-adapter concern
 * (ADR 0106.5 R8). This restores the pre-docs-native `--source` behavior.
 */
export async function readBodyFile(
  file: string,
  stdin: () => Promise<string> = readStdin,
): Promise<string> {
  if (file === STDIN_MARKER) return stdin();
  const resolved = paths.resolveUserPath(file);
  const stat = statSync(resolved, { throwIfNoEntry: false });
  if (stat === undefined) throw new Error(`File not found: ${file}`);
  if (!stat.isFile()) throw new Error(`Not a file: ${file}`);
  return readFileSync(resolved, 'utf-8');
}
