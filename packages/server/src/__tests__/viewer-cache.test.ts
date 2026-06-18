import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  isContentHashedAsset,
  viewerCacheControl,
  setViewerCacheHeaders,
} from '../utils/viewer-cache.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

describe('viewer-cache classifier (ADR 0108)', () => {
  describe('isContentHashedAsset', () => {
    it.each([
      // Real esbuild outputs from the viewer build (entryNames/assetNames '[name]-[hash]')
      'main-3LFQHTR2.js',
      'main-ZBGT667E.css',
      'logo-535ZNY3M.svg',
      'chunk-5RM6L4X6.js',
      'architecture-7HQA4BMR-VEV3UYQT.js', // multi-segment hash
      '/abs/path/to/main-3LFQHTR2.js',     // works on full paths too
    ])('treats %s as content-hashed', (name) => {
      expect(isContentHashedAsset(name)).toBe(true);
    });

    it.each([
      'index.html', // the stable entry — never hashed
      'main.js',    // unhashed entry (the pre-0108 stale-bug filename)
      'main.css',
      'logo.svg',
      'favicon.ico',
    ])('treats %s as NOT content-hashed', (name) => {
      expect(isContentHashedAsset(name)).toBe(false);
    });
  });

  describe('viewerCacheControl', () => {
    it('caches hashed assets immutably for a year', () => {
      expect(viewerCacheControl('main-3LFQHTR2.js')).toBe(IMMUTABLE);
      expect(viewerCacheControl('chunk-5RM6L4X6.js')).toBe(IMMUTABLE);
    });

    it('revalidates the unhashed HTML entry on every load', () => {
      expect(viewerCacheControl('index.html')).toBe(REVALIDATE);
    });
  });

  describe('setViewerCacheHeaders (onFound hook)', () => {
    it('writes Cache-Control onto the context', () => {
      const headers = new Map<string, string>();
      const sink = { header: (k: string, v: string) => headers.set(k, v) };

      setViewerCacheHeaders('main-3LFQHTR2.js', sink);
      expect(headers.get('Cache-Control')).toBe(IMMUTABLE);

      headers.clear();
      setViewerCacheHeaders('index.html', sink);
      expect(headers.get('Cache-Control')).toBe(REVALIDATE);
    });
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
    const path = c.req.path.replace(/^\//, '');
    setViewerCacheHeaders(path, c);
    return c.body('asset');
  });

  it('serves the hashed entry bundle as immutable', async () => {
    const res = await app.request('/main-3LFQHTR2.js');
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE);
  });

  it('serves a hashed chunk as immutable', async () => {
    const res = await app.request('/chunk-5RM6L4X6.js');
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE);
  });

  it('serves index.html with no-cache so a plain refresh always revalidates', async () => {
    const res = await app.request('/index.html');
    expect(res.headers.get('Cache-Control')).toBe(REVALIDATE);
  });
});
