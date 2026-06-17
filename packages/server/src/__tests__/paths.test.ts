import { describe, it, expect, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { sep } from 'node:path';
import { paths } from '../utils/paths.js';

describe('PathResolver tilde & path resolution', () => {
  const originalDataDir = process.env.BACKLOG_DATA_DIR;

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.BACKLOG_DATA_DIR;
    else process.env.BACKLOG_DATA_DIR = originalDataDir;
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

    it('backlogDataDir expands ~ instead of leaking it into the path', () => {
      process.env.BACKLOG_DATA_DIR = '~/Documents/goga/.backlog';
      const dir = paths.backlogDataDir;
      expect(dir).toBe(`${homedir()}/Documents/goga/.backlog`);
      expect(containsTildeSegment(dir)).toBe(false);
    });

    it('backlogDataDir defaults to ~/.backlog (user-global) when unset', () => {
      delete process.env.BACKLOG_DATA_DIR;
      const dir = paths.backlogDataDir;
      expect(dir).toBe(`${homedir()}/.backlog`);
      expect(containsTildeSegment(dir)).toBe(false);
    });

    it('backlogDataDir keeps absolute paths as-is', () => {
      process.env.BACKLOG_DATA_DIR = '/Users/gkoreli/Documents/goga/.backlog';
      expect(paths.backlogDataDir).toBe('/Users/gkoreli/Documents/goga/.backlog');
    });

    it('backlogDataDir resolves relative paths against project root', () => {
      process.env.BACKLOG_DATA_DIR = 'data';
      const dir = paths.backlogDataDir;
      expect(dir.endsWith(`${sep}data`)).toBe(true);
      expect(dir.startsWith(sep)).toBe(true);
    });
  });
});
