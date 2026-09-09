import { closeSync, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { isPathWithin } from '../../core/backlog-home.js';
import type { BacklogHome } from '../../core/backlog-home.types.js';

/** A cooperating writer owns the home lock; no mutation has been attempted. */
export class DocumentWriteBusyError extends Error {
  constructor(path: string) {
    super(`Document write lock is held: ${path}. Retry after the writer finishes; remove an abandoned lock only after confirming no writer is active.`);
    this.name = 'DocumentWriteBusyError';
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function lockDirectory(home: BacklogHome): string {
  const root = resolve(home.root);
  const directory = resolve(home.controlDir, 'state');
  if (!isPathWithin(root, directory)) {
    throw new Error('Document write lock must remain inside the selected home');
  }
  let current = realpathSync(root);
  // Create and inspect each component before descending, never following a
  // control/state symlink into another home's coordination namespace.
  for (const segment of relative(root, directory).split(sep)) {
    current = join(current, segment);
    try {
      mkdirSync(current);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Unsafe document write lock directory: ${current}`);
    }
  }
  return current;
}

/** Run synchronous disk work under a home-local exclusive lock; never steal it. */
export function withDocumentWriteLock<T>(home: BacklogHome, write: () => T): T {
  const path = join(lockDirectory(home), 'document-write.lock');
  let descriptor: number;
  try {
    descriptor = openSync(path, 'wx', 0o600);
  } catch (error) {
    if (hasCode(error, 'EEXIST')) throw new DocumentWriteBusyError(path);
    throw error;
  }
  try {
    return write();
  } finally {
    try {
      closeSync(descriptor);
    } finally {
      unlinkSync(path);
    }
  }
}

/** Yield during brief cross-process contention, with a bounded fail-closed wait. */
export async function retryDocumentWrite<T>(write: () => T): Promise<T> {
  const attempts = 100;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return write();
    } catch (error) {
      if (!(error instanceof DocumentWriteBusyError) || attempt >= attempts) throw error;
      await new Promise<void>(function pause(resolve) { setTimeout(resolve, 10); });
    }
  }
}
