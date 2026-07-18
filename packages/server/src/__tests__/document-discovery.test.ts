import {
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeAll } from 'vitest';
import { discoverDocuments } from '../core/document-discovery.js';

const DOCUMENTS_DIR = join(tmpdir(), 'aime', 'docs');
const OUTSIDE_FILE = join(tmpdir(), 'outside.md');
const REQUIREMENT_MTIME = new Date('2025-03-04T05:06:07.000Z');

function writeDocument(sourcePath: string, content: string): void {
  const absolutePath = join(DOCUMENTS_DIR, ...sourcePath.split('/'));
  const parentPath = absolutePath.slice(0, absolutePath.lastIndexOf('/'));
  mkdirSync(parentPath, { recursive: true });
  writeFileSync(absolutePath, content);
}

function findDocument(
  result: ReturnType<typeof discoverDocuments>,
  sourcePath: string,
): ReturnType<typeof discoverDocuments>['documents'][number] | undefined {
  return result.documents.find(function matchesSourcePath(document) {
    return document.sourcePath === sourcePath;
  });
}

describe('discoverDocuments', () => {
  beforeAll(() => {
    mkdirSync(DOCUMENTS_DIR, { recursive: true });
    writeDocument('adr/0023.1-uplift-driven-exploration-map.md', '# ADR 0023.1');
    writeDocument(
      'requirements/REQ-0001-identity-in-system-prompt.md',
      '---\nid: REQ-0001\n---\n# Identity',
    );
    writeDocument('prompts/0001-tasks-and-vision.md', '# Tasks and vision');
    writeDocument('prompts/0042-independent-key.md', '# Independent prompt');
    writeDocument('requirements/README.md', '# Requirements');
    writeDocument(
      'proposals/herdr-event-stream-continuity-v1.md',
      '# Event stream continuity',
    );
    writeDocument('NORTH-STAR.md', '# North star');
    writeDocument('NAMING.md', '# Naming');
    writeDocument('herdr-schema.json', '{"type":"object"}');
    writeDocument('substrates/z-last.json', '{"type":"z"}');
    writeDocument('substrates/nested/a-first.json', '{"type":"a"}');
    writeDocument('substrates/broken.json', '{"type":');
    writeDocument('substrates/notes.yaml', 'type: notes');
    writeDocument('substrates/history/z@1.json', '{"type":"z"}');
    writeDocument('adr/0042-alpha.md', '# Alpha');
    writeDocument('adr/0042-beta.md', '# Beta');
    writeDocument('notes/broken.md', '---\nid: [\n---\n# Broken');
    writeDocument('notes/config.yml', 'enabled: true');
    writeDocument('notes/guide.markdown', '# Guide');
    writeDocument('notes/unreadable.txt', 'cannot read this');
    writeDocument('..notes/inside.md', '# Legitimate in-tree directory');
    writeFileSync(OUTSIDE_FILE, '# Outside');
    symlinkSync(OUTSIDE_FILE, join(DOCUMENTS_DIR, 'escape.md'));
    utimesSync(
      join(DOCUMENTS_DIR, 'requirements/REQ-0001-identity-in-system-prompt.md'),
      REQUIREMENT_MTIME,
      REQUIREMENT_MTIME,
    );
  });

  it('catalogs the existing docs tree in normalized lexical order', () => {
    const result = discoverDocuments({
      documentsDir: DOCUMENTS_DIR,
      dependencies: {
        readDirectory: function readDirectoryInReverse(absolutePath) {
          return readdirSync(absolutePath).reverse();
        },
        readFile: function readWithOneFailure(absolutePath) {
          if (absolutePath.endsWith('unreadable.txt')) {
            throw new Error('permission denied');
          }
          return readFileSync(absolutePath, 'utf8');
        },
        getGitFirstAddDate: function getGitFirstAddDate(_absolutePath, sourcePath) {
          return sourcePath.startsWith('adr/0023.1-')
            ? '2024-01-02T03:04:05.000Z'
            : undefined;
        },
      },
    });

    expect(result.documents.map(function getSourcePath(document) {
      return document.sourcePath;
    })).toEqual([
      '..notes/inside.md',
      'NAMING.md',
      'NORTH-STAR.md',
      'adr/0023.1-uplift-driven-exploration-map.md',
      'adr/0042-alpha.md',
      'adr/0042-beta.md',
      'herdr-schema.json',
      'notes/broken.md',
      'notes/config.yml',
      'notes/guide.markdown',
      'notes/unreadable.txt',
      'prompts/0001-tasks-and-vision.md',
      'prompts/0042-independent-key.md',
      'proposals/herdr-event-stream-continuity-v1.md',
      'requirements/README.md',
      'requirements/REQ-0001-identity-in-system-prompt.md',
      'substrates/notes.yaml',
    ]);
    expect(result.declarations.map(function getSourcePath(declaration) {
      return declaration.sourcePath;
    })).toEqual([
      'substrates/broken.json',
      'substrates/nested/a-first.json',
      'substrates/z-last.json',
    ]);
    expect(result.declarations[1]?.value).toEqual({ type: 'a' });
    // Frozen history (ADR 0122 R2) is lineage, not a live declaration.
    expect(result.substrateHistory).toEqual([{
      sourcePath: 'substrates/history/z@1.json',
      absolutePath: join(DOCUMENTS_DIR, 'substrates', 'history', 'z@1.json'),
    }]);
    expect(result.documents.some(function isEscaped(document) {
      return document.sourcePath === 'escape.md';
    })).toBe(false);
  });

  it('parses neutral identities, declared ids, and chronology provenance', () => {
    const result = discoverDocuments({
      documentsDir: DOCUMENTS_DIR,
      dependencies: {
        getGitFirstAddDate: function getGitFirstAddDate(_absolutePath, sourcePath) {
          return sourcePath.startsWith('adr/0023.1-')
            ? ' 2024-01-02T03:04:05.000Z '
            : undefined;
        },
      },
    });

    expect(findDocument(result, 'adr/0023.1-uplift-driven-exploration-map.md')?.identity)
      .toMatchObject({
        sourcePath: 'adr/0023.1-uplift-driven-exploration-map.md',
        pathKey: '0023.1',
        slug: 'uplift-driven-exploration-map',
        threadRootKey: '0023',
        observedDate: '2024-01-02T03:04:05.000Z',
        dateSource: 'git-first-add',
      });
    expect(
      findDocument(
        result,
        'requirements/REQ-0001-identity-in-system-prompt.md',
      )?.identity,
    ).toMatchObject({
      pathKey: 'REQ-0001',
      declaredId: 'REQ-0001',
      slug: 'identity-in-system-prompt',
      observedDate: REQUIREMENT_MTIME.toISOString(),
      dateSource: 'filesystem-mtime',
    });
    expect(findDocument(result, 'prompts/0001-tasks-and-vision.md')?.identity)
      .toMatchObject({
        pathKey: '0001',
        slug: 'tasks-and-vision',
      });
    expect(findDocument(result, 'requirements/README.md')?.identity.pathKey)
      .toBeUndefined();
  });

  it('falls back to filesystem mtime when injected Git chronology is invalid', () => {
    const result = discoverDocuments({
      documentsDir: DOCUMENTS_DIR,
      dependencies: {
        getGitFirstAddDate: function getInvalidGitDate(_absolutePath, sourcePath) {
          return sourcePath.startsWith('requirements/REQ-0001-')
            ? 'not-a-date'
            : undefined;
        },
      },
    });

    expect(
      findDocument(
        result,
        'requirements/REQ-0001-identity-in-system-prompt.md',
      )?.identity,
    ).toMatchObject({
      observedDate: REQUIREMENT_MTIME.toISOString(),
      dateSource: 'filesystem-mtime',
    });
  });

  it('keeps date-named documents generic without duplicate identity diagnostics', () => {
    const dateDocumentsDir = join(tmpdir(), 'date-named-documents');
    mkdirSync(`${dateDocumentsDir}/notes`, { recursive: true });
    writeFileSync(`${dateDocumentsDir}/notes/2026-07-16-alpha.md`, '# Alpha');
    writeFileSync(`${dateDocumentsDir}/notes/2026-07-16-beta.md`, '# Beta');

    const result = discoverDocuments({ documentsDir: dateDocumentsDir });

    expect(result.documents.map(function getPathKey(document) {
      return document.identity.pathKey;
    })).toEqual([undefined, undefined]);
    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-path-key' }),
    ]));
  });

  it('reports malformed, unreadable, escaping, and duplicate paths without choosing a winner', () => {
    const result = discoverDocuments({
      documentsDir: DOCUMENTS_DIR,
      dependencies: {
        readFile: function readWithOneFailure(absolutePath) {
          if (absolutePath.endsWith('unreadable.txt')) {
            throw new Error('permission denied');
          }
          return readFileSync(absolutePath, 'utf8');
        },
      },
    });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'malformed-frontmatter',
        sourcePaths: ['notes/broken.md'],
      }),
      expect.objectContaining({
        code: 'malformed-substrate-declaration',
        sourcePaths: ['substrates/broken.json'],
      }),
      expect.objectContaining({
        code: 'file-unreadable',
        sourcePaths: ['notes/unreadable.txt'],
      }),
      expect.objectContaining({
        code: 'symlink-outside-documents',
        sourcePaths: ['escape.md'],
      }),
      expect.objectContaining({
        code: 'duplicate-path-key',
        sourcePaths: ['adr/0042-alpha.md', 'adr/0042-beta.md'],
      }),
    ]));
    expect(findDocument(result, 'adr/0042-alpha.md')).toBeDefined();
    expect(findDocument(result, 'adr/0042-beta.md')).toBeDefined();
    expect(findDocument(result, 'notes/unreadable.txt')).toMatchObject({
      sourcePath: 'notes/unreadable.txt',
      content: undefined,
    });
  });

  it('returns a root diagnostic instead of throwing for an unreadable documents directory', () => {
    const result = discoverDocuments({
      documentsDir: join(tmpdir(), 'missing-documents'),
    });

    expect(result).toMatchObject({
      documents: [],
      declarations: [],
      diagnostics: [
        {
          code: 'documents-dir-unreadable',
          sourcePaths: ['.'],
        },
      ],
    });
  });
});
