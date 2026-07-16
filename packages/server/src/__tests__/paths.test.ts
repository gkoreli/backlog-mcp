import { describe, it, expect, afterEach, vi } from 'vitest';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { paths } from '../utils/paths.js';

describe('PathResolver tilde & path resolution', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  describe('expandTilde', () => {
    it('expands a bare ~ to the home directory', () => {
      expect(paths.expandTilde('~')).toBe(homedir());
    });

    it('expands a leading ~/ to a path under home', () => {
      expect(paths.expandTilde('~/Documents/goga')).toBe(`${homedir()}/Documents/goga`);
    });

    it('leaves absolute paths untouched', () => {
      expect(paths.expandTilde('/var/data')).toBe('/var/data');
    });

    it('leaves relative paths untouched', () => {
      expect(paths.expandTilde('data/tasks')).toBe('data/tasks');
    });

    it('does not expand ~user (only ~ and ~/)', () => {
      // homedir() cannot resolve another user's home — leave it for the OS to reject.
      expect(paths.expandTilde('~someone/foo')).toBe('~someone/foo');
    });
  });

  describe('INVARIANT: a resolved path never contains a literal ~ segment', () => {
    // This is the regression. A '~/...' value classified as "absolute" and returned
    // verbatim gets join()/resolve()'d against the CWD downstream, producing
    // '/cwd/~/...'. No resolved path should ever carry a '~' path segment.
    const containsTildeSegment = (p: string) => p.split(sep).includes('~');

    it('resolveUserPath never yields a ~ segment', () => {
      for (const input of ['~', '~/Documents/goga/.backlog', '~/notes.md']) {
        const resolved = paths.resolveUserPath(input);
        expect(resolved.startsWith(homedir())).toBe(true);
        expect(containsTildeSegment(resolved)).toBe(false);
      }
    });

  });

  describe('viewer assets', () => {
    it('defaults source-mode viewer assets to production when NODE_ENV is unset', async () => {
      delete process.env.NODE_ENV;
      const { paths: freshPaths } = await import('../utils/paths.js');

      expect(freshPaths.viewerDist).toBe(join(freshPaths.distRoot, 'viewer'));
      expect(freshPaths.viewerDist.endsWith(`${sep}src${sep}viewer`)).toBe(false);
    });

    it('respects explicit development for source-mode viewer assets', async () => {
      process.env.NODE_ENV = 'development';
      const { paths: freshPaths } = await import('../utils/paths.js');

      expect(freshPaths.viewerDist).toBe(join(freshPaths.projectRoot, '../viewer/dist'));
    });

    it('respects explicit production without resolving to src/viewer', async () => {
      process.env.NODE_ENV = 'production';
      const { paths: freshPaths } = await import('../utils/paths.js');

      expect(freshPaths.viewerDist).toBe(join(freshPaths.distRoot, 'viewer'));
      expect(freshPaths.viewerDist.endsWith(`${sep}src${sep}viewer`)).toBe(false);
    });
  });
});
