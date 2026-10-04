import { describe, it, expect, afterEach, vi } from 'vitest';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { PathResolver, RuntimeEnvironment, paths } from '../utils/paths.js';

const { resolvePackage } = vi.hoisted(function packageResolutionStub() {
  return { resolvePackage: vi.fn() };
});
vi.mock('node:module', function moduleResolution() {
  return { createRequire: function createRequire() { return { resolve: resolvePackage }; } };
});

describe('PathResolver tilde & path resolution', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it('canonicalizes the nearest existing ancestor through explicit read capabilities', function injectedCanonicalization() {
    const exists = vi.fn(function exists(path: string) { return path === '/logical/root'; });
    const canonicalize = vi.fn(function canonicalize() { return '/physical/root'; });
    expect(paths.canonicalizeThroughExistingAncestor('/logical/root/new/docs', { exists, canonicalize })).toBe('/physical/root/new/docs');
    expect(canonicalize).toHaveBeenCalledTimes(1);
    expect(canonicalize).toHaveBeenCalledWith('/logical/root');
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

  it.each(['src', 'dist'])('keeps package roots under ancestor src directories (%s mode)', function nestedSourceName(mode) {
    const root = '/fixtures/src/parent/package';
    const actual = PathResolver.resolveRuntimePaths(`${root}/${mode}/utils`, RuntimeEnvironment.Production);
    expect(actual).toEqual({ projectRoot: root, distRoot: `${root}/dist`, viewerDist: `${root}/dist/viewer` });
    expect(PathResolver.resolveRuntimePaths(`${root}/${mode}/utils`, RuntimeEnvironment.Development).viewerDist)
      .toBe('/fixtures/src/parent/viewer/dist');
  });

  it('resolves invocation-specific user bases and home directories without caching them', function callerPaths() {
    expect(paths.resolveUserPath('notes/file.md', '/caller/a')).toBe('/caller/a/notes/file.md');
    expect(paths.resolveUserPath('notes/file.md', '/caller/b')).toBe('/caller/b/notes/file.md');
    expect(paths.resolveUserPath('~/notes/file.md', '/caller/a', '/user/first')).toBe('/user/first/notes/file.md');
    expect(paths.resolveUserPath('~/notes/file.md', '/caller/b', '/user/second')).toBe('/user/second/notes/file.md');
    expect(paths.resolveUserPath('~someone/notes', '/caller/a', '/user/first')).toBe('/caller/a/~someone/notes');
    expect(paths.resolveUserPath('/absolute/file', '/caller/a')).toBe('/absolute/file');
  });

  it('canonicalizes existing symlink ancestors while preserving a missing suffix', function missingCanonicalSuffix() {
    mkdirSync('/resolver-canonical/physical', { recursive: true });
    symlinkSync('/resolver-canonical/physical', '/resolver-canonical/link', 'dir');
    expect(paths.canonicalizeThroughExistingAncestor('/resolver-canonical/link/new/deep/document.md'))
      .toBe('/resolver-canonical/physical/new/deep/document.md');
    expect(paths.canonicalizeThroughExistingAncestor('/resolver-canonical/physical'))
      .toBe('/resolver-canonical/physical');
    expect(paths.canonicalizeExistingPath('/resolver-canonical/link')).toBe('/resolver-canonical/physical');
    expect(function strictMissingFile() {
      paths.canonicalizeExistingPath('/resolver-canonical/link/new/deep/document.md');
    }).toThrow();
  });

  it('resolves binaries from package metadata rather than a node_modules layout', function metadataBinary() {
    const root = '/virtual-store/remote-package';
    mkdirSync(root, { recursive: true });
    const metadata = `${root}/package.json`;
    resolvePackage.mockReturnValue(metadata);
    writeFileSync(metadata, JSON.stringify({ bin: { 'mcp-remote': 'dist/proxy.js' } }));
    expect(paths.getBinPath('mcp-remote')).toBe(`${root}/dist/proxy.js`);
    expect(resolvePackage).toHaveBeenCalledWith('mcp-remote/package.json');
    writeFileSync(metadata, JSON.stringify({ bin: 'bin/start.js' }));
    expect(paths.getBinPath('mcp-remote')).toBe(`${root}/bin/start.js`);
    writeFileSync(metadata, JSON.stringify({ bin: { other: 'bin/other.js' } }));
    expect(function absentBinary() { paths.getBinPath('mcp-remote'); }).toThrow("no bin entry for 'mcp-remote'");
  });
});
