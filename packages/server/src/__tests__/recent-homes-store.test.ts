import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  RecentHomesStore,
  defaultHomeLabel,
  noopRecentHomesObserver,
  recentHomesManifestPath,
} from '../storage/local/recent-homes-store.js';

function manifestPathFor(name: string): string {
  const controlDir = join(tmpdir(), 'recent-homes', name);
  const manifestPath = recentHomesManifestPath(controlDir);
  // Pre-create the state dir so tests that write a manifest directly (to
  // exercise the read path) don't depend on the store having run first.
  mkdirSync(dirname(manifestPath), { recursive: true });
  return manifestPath;
}

// A deterministic clock so `first_seen`/`last_seen` are assertable.
function clockFrom(...isoTimes: string[]): () => Date {
  let i = 0;
  return () => new Date(isoTimes[Math.min(i++, isoTimes.length - 1)] ?? isoTimes[0] ?? '2026-01-01T00:00:00.000Z');
}

describe('RecentHomesStore (ADR 0128)', () => {
  it('appends a new project home on first record', () => {
    const store = new RecentHomesStore(
      manifestPathFor('append'),
      clockFrom('2026-07-20T10:00:00.000Z'),
    );
    store.recordProjectHome('/repos/alpha', 'alpha');

    const homes = store.read();
    expect(homes).toEqual([
      {
        root: '/repos/alpha',
        label: 'alpha',
        first_seen: '2026-07-20T10:00:00.000Z',
        last_seen: '2026-07-20T10:00:00.000Z',
      },
    ]);
  });

  it('bumps last_seen without duplicating on repeat use (R3)', () => {
    const store = new RecentHomesStore(
      manifestPathFor('bump'),
      clockFrom('2026-07-20T10:00:00.000Z', '2026-07-20T11:30:00.000Z'),
    );
    store.recordProjectHome('/repos/alpha', 'alpha');
    store.recordProjectHome('/repos/alpha', 'alpha-renamed');

    const homes = store.read();
    expect(homes).toHaveLength(1);
    expect(homes[0]).toMatchObject({
      root: '/repos/alpha',
      label: 'alpha-renamed', // label kept fresh on rename
      first_seen: '2026-07-20T10:00:00.000Z',
      last_seen: '2026-07-20T11:30:00.000Z',
    });
  });

  it('reads most-recent-first across multiple homes', () => {
    const store = new RecentHomesStore(
      manifestPathFor('order'),
      clockFrom('2026-07-20T09:00:00.000Z', '2026-07-20T12:00:00.000Z'),
    );
    store.recordProjectHome('/repos/alpha', 'alpha');
    store.recordProjectHome('/repos/beta', 'beta');

    expect(store.read().map((h) => h.root)).toEqual([
      '/repos/beta',
      '/repos/alpha',
    ]);
  });

  it('forgets one entry idempotently (R6)', () => {
    const path = manifestPathFor('forget');
    const store = new RecentHomesStore(path, clockFrom('2026-07-20T10:00:00.000Z'));
    store.recordProjectHome('/repos/alpha', 'alpha');
    store.recordProjectHome('/repos/beta', 'beta');

    expect(store.forget('/repos/alpha')).toBe(true);
    expect(store.read().map((h) => h.root)).toEqual(['/repos/beta']);
    // Second forget of the same root is a no-op.
    expect(store.forget('/repos/alpha')).toBe(false);
  });

  it('reads empty on a missing manifest and never throws', () => {
    const store = new RecentHomesStore(manifestPathFor('missing-read'));
    expect(store.read()).toEqual([]);
  });

  it('reads empty on a corrupt manifest (fail-open, R4)', () => {
    const path = manifestPathFor('corrupt');
    writeFileSync(path, '{ not valid json');
    const store = new RecentHomesStore(path);
    expect(store.read()).toEqual([]);
  });

  it('ignores a wrong-version or wrong-shape manifest', () => {
    const path = manifestPathFor('bad-shape');
    writeFileSync(path, JSON.stringify({ version: 99, homes: 'nope' }));
    const store = new RecentHomesStore(path);
    expect(store.read()).toEqual([]);
  });

  it('persists a versioned, human-readable manifest', () => {
    const path = manifestPathFor('shape');
    const store = new RecentHomesStore(path, clockFrom('2026-07-20T10:00:00.000Z'));
    store.recordProjectHome('/repos/alpha', 'alpha');

    const written = JSON.parse(readFileSync(path, 'utf-8')) as {
      version: number;
      homes: unknown[];
    };
    expect(written.version).toBe(1);
    expect(written.homes).toHaveLength(1);
  });

  it('record never throws even if the path is unwritable (fail-open, R4)', () => {
    // A path whose parent cannot be created (a file where a dir is expected).
    const filePath = join(tmpdir(), 'recent-homes-blocker');
    writeFileSync(filePath, 'x');
    const store = new RecentHomesStore(join(filePath, 'nested', 'homes.json'));
    expect(() => store.recordProjectHome('/repos/alpha', 'alpha')).not.toThrow();
    expect(store.read()).toEqual([]);
  });

  it('noop observer records nothing', () => {
    expect(() => noopRecentHomesObserver.recordProjectHome('/x', 'x')).not.toThrow();
  });

  it('defaultHomeLabel is the trailing path segment', () => {
    expect(defaultHomeLabel('/Users/goga/Documents/backlog-mcp')).toBe('backlog-mcp');
    expect(defaultHomeLabel('/')).toBe('/');
  });
});
