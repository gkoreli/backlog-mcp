import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, describe, expect, it } from 'vitest';
import { ResourceManager } from '../resources/manager.js';

const ROOT_DIR = join(tmpdir(), 'resource-manager-root');
const LEGACY_ROOT_DIR = join(tmpdir(), 'legacy-resource-manager-root');
const LEGACY_SCAN_DIR = join(LEGACY_ROOT_DIR, 'resources');
const OUTSIDE_FILE = join(tmpdir(), 'resource-manager-outside.md');

function writeDocument(rootDir: string, sourcePath: string, content: string): void {
  const filePath = join(rootDir, ...sourcePath.split('/'));
  const parentDir = filePath.slice(0, filePath.lastIndexOf('/'));
  mkdirSync(parentDir, { recursive: true });
  writeFileSync(filePath, content);
}

describe('ResourceManager', () => {
  beforeAll(() => {
    writeDocument(
      ROOT_DIR,
      'tasks/TASK-0001.md',
      '---\nid: TASK-0001\n---\n# Task 1',
    );
    writeDocument(ROOT_DIR, 'README.markdown', '# Home Documents');
    writeDocument(ROOT_DIR, 'config.json', '{"key":"value"}');
    writeDocument(ROOT_DIR, 'notes.txt', 'Plain notes');
    writeDocument(ROOT_DIR, 'settings.yaml', 'enabled: true');
    writeDocument(ROOT_DIR, 'settings.yml', 'mode: local');
    writeDocument(ROOT_DIR, 'nested/zeta.md', '# Zeta');
    writeDocument(ROOT_DIR, 'nested/alpha.md', '# Alpha');
    writeDocument(ROOT_DIR, 'substrates/declaration.json', '{"type":"built-in"}');
    writeDocument(ROOT_DIR, 'substrates/notes.yaml', 'type: notes');
    writeDocument(ROOT_DIR, 'ignored.ts', 'export const ignored = true;');
    writeDocument(ROOT_DIR, '..notes/inside.md', '# Dot Dot Notes');
    writeFileSync(OUTSIDE_FILE, '# Outside');
    symlinkSync(OUTSIDE_FILE, join(ROOT_DIR, 'escape.md'));

    writeDocument(LEGACY_ROOT_DIR, 'tasks/TASK-9999.md', '# Not Legacy Search');
    writeDocument(LEGACY_SCAN_DIR, 'beta.txt', 'Beta');
    writeDocument(LEGACY_SCAN_DIR, 'alpha.md', '# Legacy Alpha');
    writeDocument(
      LEGACY_SCAN_DIR,
      'substrates/declaration.json',
      '{"type":"legacy"}',
    );
  });

  describe('list()', () => {
    it('scans the whole root by default and returns all supported document formats', () => {
      const resources = new ResourceManager(ROOT_DIR).list();

      expect(resources.map(function getPath(resource) {
        return resource.path;
      })).toEqual([
        '..notes/inside.md',
        'README.markdown',
        'config.json',
        'nested/alpha.md',
        'nested/zeta.md',
        'notes.txt',
        'settings.yaml',
        'settings.yml',
        'substrates/notes.yaml',
        'tasks/TASK-0001.md',
      ]);
      expect(resources.map(function getUri(resource) {
        return resource.id;
      })).toEqual(resources.map(function makeExpectedUri(resource) {
        return `mcp://backlog/${resource.path}`;
      }));
      expect(resources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'README.markdown',
          title: 'Home Documents',
        }),
        expect.objectContaining({
          path: 'config.json',
          title: 'config',
          content: '{"key":"value"}',
        }),
      ]));
      expect(resources.some(function isUnsupported(resource) {
        return resource.path === 'ignored.ts';
      })).toBe(false);
    });

    it('excludes substrate JSON declarations from search resources', () => {
      const resources = new ResourceManager(ROOT_DIR).list();

      expect(resources.some(function isDeclaration(resource) {
        return resource.path === 'substrates/declaration.json';
      })).toBe(false);
      expect(resources.some(function isOrdinarySubstrateDocument(resource) {
        return resource.path === 'substrates/notes.yaml';
      })).toBe(true);
    });

    it('prefixes paths when a legacy resources-only scan differs from the root', () => {
      const resources = new ResourceManager(LEGACY_ROOT_DIR, LEGACY_SCAN_DIR).list();

      expect(resources.map(function getPath(resource) {
        return resource.path;
      })).toEqual([
        'resources/alpha.md',
        'resources/beta.txt',
      ]);
      expect(resources.map(function getUri(resource) {
        return resource.id;
      })).toEqual([
        'mcp://backlog/resources/alpha.md',
        'mcp://backlog/resources/beta.txt',
      ]);
    });
  });

  describe('resolve()', () => {
    const manager = new ResourceManager(ROOT_DIR);

    it('resolves catch-all and nested URIs beneath the root', () => {
      expect(manager.resolve('mcp://backlog/tasks/TASK-0001.md'))
        .toBe(join(ROOT_DIR, 'tasks', 'TASK-0001.md'));
      expect(manager.resolve('mcp://backlog/resources/nested/file.md'))
        .toBe(join(ROOT_DIR, 'resources', 'nested', 'file.md'));
    });

    it('does not add a markdown extension automatically', () => {
      const uri = 'mcp://backlog/tasks/TASK-0001';

      expect(manager.resolve(uri)).toBe(join(ROOT_DIR, 'tasks', 'TASK-0001'));
      expect(() => manager.read(uri))
        .toThrow('Did you mean: mcp://backlog/tasks/TASK-0001.md?');
    });

    it('rejects invalid schemes, hosts, and parent path segments', () => {
      expect(() => manager.resolve('http://backlog/tasks')).toThrow('Not an MCP URI');
      expect(() => manager.resolve('mcp://other/tasks')).toThrow('Invalid hostname');
      expect(() => manager.resolve('mcp://backlog/../etc/passwd'))
        .toThrow('Path traversal');
      expect(() => manager.resolve('mcp://backlog/%2e%2e/etc/passwd'))
        .toThrow('Path traversal');
    });

    it('allows contained names that merely include two dots', () => {
      expect(manager.resolve('mcp://backlog/..notes/inside.md'))
        .toBe(join(ROOT_DIR, '..notes', 'inside.md'));
    });
  });

  describe('read()', () => {
    const manager = new ResourceManager(ROOT_DIR);

    it('reads markdown and preserves frontmatter parsing', () => {
      expect(manager.read('mcp://backlog/tasks/TASK-0001.md')).toEqual({
        content: '# Task 1',
        frontmatter: { id: 'TASK-0001' },
        mimeType: 'text/markdown',
      });
      expect(manager.read('mcp://backlog/README.markdown')).toEqual({
        content: '# Home Documents',
        mimeType: 'text/markdown',
      });
    });

    it('reads generic formats with the correct MIME types', () => {
      expect(manager.read('mcp://backlog/config.json').mimeType)
        .toBe('application/json');
      expect(manager.read('mcp://backlog/settings.yaml').mimeType)
        .toBe('application/yaml');
      expect(manager.read('mcp://backlog/settings.yml').mimeType)
        .toBe('application/yaml');
      expect(manager.read('mcp://backlog/notes.txt').mimeType)
        .toBe('text/plain');
    });

    it('throws for a missing resource', () => {
      expect(() => manager.read('mcp://backlog/missing.md')).toThrow('not found');
    });

    it('refuses an in-root symlink whose target is outside the root', () => {
      expect(() => manager.read('mcp://backlog/escape.md'))
        .toThrow('Resource resolves outside root');
    });
  });

  describe('docs-native root anchoring (first-impression Slice A)', () => {
    const HOME_ROOT = join(tmpdir(), 'resource-manager-home-root');
    const DOCS_DIR = join(HOME_ROOT, 'docs');
    let manager: ResourceManager;

    beforeAll(() => {
      writeDocument(HOME_ROOT, 'README.md', '# Repo Overview\n\nEcosystem framing.');
      writeDocument(HOME_ROOT, 'AGENTS.md', '# Contributor Rules');
      writeDocument(HOME_ROOT, 'NORTH_STAR.md', '# The Vision');
      writeDocument(HOME_ROOT, 'package.json', '{"name":"not-a-resource"}');
      writeDocument(HOME_ROOT, 'src/secret.md', '# Never Addressable');
      writeDocument(DOCS_DIR, 'adr/0001-first.md', '# First Decision');
      manager = new ResourceManager(HOME_ROOT, DOCS_DIR);
    });

    it('lists docs under a root-relative prefix plus the repo-root orientation files', () => {
      const paths = manager.list().map(function getPath(resource) {
        return resource.path;
      });
      expect(paths).toEqual([
        'AGENTS.md',
        'NORTH_STAR.md',
        'README.md',
        'docs/adr/0001-first.md',
      ]);
      expect(manager.scanPrefix).toBe('docs');
    });

    it('orientation files hydrate by the same listed ID', () => {
      expect(manager.read('mcp://backlog/README.md').content)
        .toContain('Ecosystem framing');
      expect(manager.read('mcp://backlog/NORTH_STAR.md').content)
        .toContain('The Vision');
      expect(manager.read('mcp://backlog/docs/adr/0001-first.md').content)
        .toContain('First Decision');
    });

    it('the rest of the repository stays unaddressable', () => {
      expect(() => manager.resolve('mcp://backlog/src/secret.md'))
        .toThrow('outside the documents surface');
      expect(() => manager.resolve('mcp://backlog/package.json'))
        .toThrow('outside the documents surface');
      expect(manager.toUri(join(HOME_ROOT, 'src', 'secret.md'))).toBeNull();
      expect(manager.toUri(join(HOME_ROOT, 'README.md')))
        .toBe('mcp://backlog/README.md');
    });
  });

  describe('lenient markdown reads (EXP-1 B-3)', () => {
    it('returns the raw bytes with a labeled diagnostic when frontmatter cannot parse', () => {
      const malformed = '---\ntitle: broken (domain: aime)\n---\n\n# Body survives\n';
      writeDocument(ROOT_DIR, 'requirements/REQ-0004-broken.md', malformed);
      const manager = new ResourceManager(ROOT_DIR);

      const resource = manager.read('mcp://backlog/requirements/REQ-0004-broken.md');
      expect(resource.content).toBe(malformed);          // lossless — never coerced
      expect(resource.frontmatter).toBeUndefined();
      expect(resource.frontmatterError).toContain('mapping');
      expect(resource.mimeType).toBe('text/markdown');
    });
  });

  describe('declared frontmatter status (BUG-0003)', () => {
    const STATUS_ROOT = join(tmpdir(), 'resource-manager-status-root');

    beforeAll(() => {
      writeDocument(STATUS_ROOT, 'issues/0001-open.md', '---\nstatus: Open\n---\n\n# Open issue\n');
      writeDocument(STATUS_ROOT, 'issues/0002-resolved.md', '---\nstatus: Resolved (2026-07-01)\n---\n\n# Resolved issue\n');
      writeDocument(STATUS_ROOT, 'issues/0003-none.md', '# No declared status\n');
      writeDocument(STATUS_ROOT, 'issues/0004-numeric.md', '---\nstatus: 2\n---\n\n# Numeric status\n');
    });

    function statusByPath(path: string): string | undefined {
      const resources = new ResourceManager(STATUS_ROOT).list();
      return resources.find(resource => resource.path === path)?.status;
    }

    it('carries the declared status raw and lossless into the catalog', () => {
      expect(statusByPath('issues/0001-open.md')).toBe('Open');
      expect(statusByPath('issues/0002-resolved.md')).toBe('Resolved (2026-07-01)');
    });

    it('omits status when the document declares none or declares a non-string', () => {
      expect(statusByPath('issues/0003-none.md')).toBeUndefined();
      expect(statusByPath('issues/0004-numeric.md')).toBeUndefined();
    });

    it('keeps content lossless — status extraction never rewrites the document', () => {
      const resources = new ResourceManager(STATUS_ROOT).list();
      const open = resources.find(resource => resource.path === 'issues/0001-open.md');
      expect(open?.content).toBe('---\nstatus: Open\n---\n\n# Open issue\n');
    });
  });

  describe('toUri()', () => {
    const manager = new ResourceManager(ROOT_DIR);

    it('converts contained paths and round-trips nested URIs', () => {
      const uri = 'mcp://backlog/tasks/TASK-0001.md';
      const filePath = manager.resolve(uri);

      expect(manager.toUri(filePath)).toBe(uri);
      expect(manager.toUri(join(ROOT_DIR, 'resources', 'nested', 'file.md')))
        .toBe('mcp://backlog/resources/nested/file.md');
    });

    it('rejects outside paths, including sibling paths with the same prefix', () => {
      expect(manager.toUri('/some/other/path/file.md')).toBeNull();
      expect(manager.toUri(join(`${ROOT_DIR}-sibling`, 'file.md'))).toBeNull();
      expect(manager.toUri(join(ROOT_DIR, 'escape.md'))).toBeNull();
    });
  });
});
