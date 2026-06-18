import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  CacheControl,
  isContentHashedAsset,
  viewerCacheControl,
  setViewerCacheHeaders,
} from '../utils/viewer-cache.js';

// Real esbuild outputs from the viewer build (entryNames/assetNames '[name]-[hash]').
const HASHED = [
  'main-3LFQHTR2.js',
  'main-ZBGT667E.css',
  'logo-535ZNY3M.svg',
  'chunk-5RM6L4X6.js',
  'architecture-7HQA4BMR-VEV3UYQT.js', // multi-segment hash — trailing hash wins
  '/abs/path/to/main-3LFQHTR2.js',     // full paths classify by basename suffix
];

// Stable-URL or otherwise non-content-addressed names.
const UNHASHED = [
  'index.html',  // the single stable entry — MUST always revalidate
  'main.js',     // the pre-0108 unhashed entry (the stale-bug filename)
  'main.css',
  'logo.svg',
  'favicon.ico',
  'main-3LFQHTR2.js.map', // sourcemap: trailing ext is .map, not a hash slot
  'main-0189ABCD.js',     // 0/1/8/9 are NOT in esbuild's base32 alphabet
  'data-deadbeef.js',     // lowercase ≠ esbuild's uppercase base32
  'main-ABC123.js',       // wrong hash length (6, not 8)
  '',                     // empty / odd input
];

describe('viewer-cache invariants (ADR 0108)', () => {
  it('INV-1 (fail-safe default): every non-hashed name revalidates', () => {
    for (const name of UNHASHED) {
      expect(viewerCacheControl(name)).toBe(CacheControl.REVALIDATE);
    }
  });

  it('INV-2 (equivalence): a path is immutable IFF it is a content-hashed asset', () => {
    for (const name of [...HASHED, ...UNHASHED]) {
      const immutable = viewerCacheControl(name) === CacheControl.IMMUTABLE;
      expect(immutable).toBe(isContentHashedAsset(name));
    }
  });

  it('INV-3 (no stale-bug direction): index.html is NEVER immutable', () => {
    // The one stable-URL viewer file must always revalidate, regardless of path form.
    for (const p of ['index.html', '/index.html', './index.html', 'sub/index.html']) {
      expect(viewerCacheControl(p)).toBe(CacheControl.REVALIDATE);
    }
  });

  it('INV-4 (closed policy): only the two known policies are ever emitted', () => {
    const allowed = new Set<string>([CacheControl.IMMUTABLE, CacheControl.REVALIDATE]);
    for (const name of [...HASHED, ...UNHASHED]) {
      expect(allowed.has(viewerCacheControl(name))).toBe(true);
    }
  });

  it('INV-5 (base32 alphabet): real hashed outputs are immutable', () => {
    for (const name of HASHED) {
      expect(viewerCacheControl(name)).toBe(CacheControl.IMMUTABLE);
    }
  });

  it('INV-6 (hook fidelity): setViewerCacheHeaders writes exactly viewerCacheControl(path)', () => {
    for (const name of [...HASHED, ...UNHASHED]) {
      const headers = new Map<string, string>();
      setViewerCacheHeaders(name, { header: (k, v) => headers.set(k, v) });
      expect(headers.get('Cache-Control')).toBe(viewerCacheControl(name));
    }
  });
});

describe('viewer-cache served headers — integration via Hono context (ADR 0108)', () => {
  // serve-static invokes `onFound(path, c)` (see @hono/node-server
  // serve-static.js: `await options.onFound?.(path, c)`). This exercises that
  // exact hook against a real Hono Context, proving the header set in onFound
  // propagates to the actual Response — without depending on serve-static's
  // file I/O (which bypasses the memfs mock).
  const app = new Hono();
  app.use('/*', async (c) => {
    setViewerCacheHeaders(c.req.path.replace(/^\//, ''), c);
    return c.body('asset');
  });

  it('serves the hashed entry bundle as immutable', async () => {
    const res = await app.request('/main-3LFQHTR2.js');
    expect(res.headers.get('Cache-Control')).toBe(CacheControl.IMMUTABLE);
  });

  it('serves a hashed chunk as immutable', async () => {
    const res = await app.request('/chunk-5RM6L4X6.js');
    expect(res.headers.get('Cache-Control')).toBe(CacheControl.IMMUTABLE);
  });

  it('serves index.html with no-cache so a plain refresh always revalidates', async () => {
    const res = await app.request('/index.html');
    expect(res.headers.get('Cache-Control')).toBe(CacheControl.REVALIDATE);
  });
});
