/** Publish complete Markdown without exposing a truncated authoritative document. */
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, linkSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Caller owns containment and the home lock. Exclusive creation never replaces a native file. */
export function writeMarkdownFile(path: string, markdown: string, exclusive: boolean): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const mode = !exclusive && existsSync(path) ? statSync(path).mode & 0o7777 : undefined;
  try {
    writeFileSync(temporary, markdown, { flag: 'wx', ...(mode === undefined ? {} : { mode }) });
    // Creation mode is masked by umask; restore existing bits before publication.
    if (mode !== undefined) chmodSync(temporary, mode);
    if (exclusive) linkSync(temporary, path);
    else renameSync(temporary, path);
  } finally {
    // Cleanup is derived work: a published document must not become a failed receipt.
    try { unlinkSync(temporary); } catch { /* absent after rename, or best-effort cleanup */ }
  }
}
