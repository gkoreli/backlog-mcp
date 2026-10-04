/** Best-effort derived cache I/O and debounce lifetime, separate from active search state. */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseSearchIndexSnapshot, type SearchIndexSnapshot } from './search-index-snapshot.js';

/** Cache owns an already selected path, never home selection or path resolution. */
export class SearchIndexCache {
  private pending: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly path: string,
    private readonly version: number,
    private readonly snapshot: () => SearchIndexSnapshot | undefined,
  ) {}

  /** Missing, incompatible or malformed cache is a miss; rebuild from authoritative data. */
  read(): SearchIndexSnapshot | undefined {
    try {
      if (!existsSync(this.path)) return undefined;
      return parseSearchIndexSnapshot(JSON.parse(readFileSync(this.path, 'utf8')), this.version);
    } catch {
      return undefined;
    }
  }

  /** Debounce a derived snapshot; the callback reads the active state at publication time. */
  schedule(): void {
    if (this.pending !== undefined) clearTimeout(this.pending);
    const cache = this;
    this.pending = setTimeout(function persistScheduledSnapshot() {
      cache.pending = undefined;
      cache.persist();
    }, 1000);
  }

  /** Cancel pending work and persist exactly the current active state. */
  flush(): void {
    if (this.pending !== undefined) clearTimeout(this.pending);
    this.pending = undefined;
    this.persist();
  }

  /** Publish complete cache bytes; failed writes retain the previous cache, not a truncated file. */
  persist(): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const snapshot = this.snapshot();
      if (snapshot === undefined) return;
      const serialized = JSON.stringify(snapshot);
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(temporary, serialized, { flag: 'wx' });
      renameSync(temporary, this.path);
    } catch (error) {
      console.warn('[search] persistToDisk failed:', error instanceof Error ? error.message : error);
    } finally {
      // Cleanup failure cannot turn a published derived snapshot into a failed write.
      try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* best-effort temporary cleanup */ }
    }
  }
}
