import { createBacklogHome } from '../storage/local/backlog-home.js';
/** Planner/execute separation over the global memfs, with no real filesystem writes. */
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import { localHome } from './helpers/local-home.js';
import { buildEntity } from '../storage/entity-factory.js';
import { planDocsNativeMigration as domainPlan } from '../core/migrate-docs-native.js';
import type { DocsNativeMigrationReadPort } from '../core/migrate-docs-native.types.js';
import { planDocsNativeMigration as localPlan } from '../storage/local/migrate-docs-native.js';
import { createMigrationFileSystem } from '../storage/local/migrate-docs-native-filesystem.js';
import { executeDocsNativeMigrationPlan } from '../storage/local/migrate-docs-native-executor.js';

function migrationFixture(name: string) {
  const graph = localHome(name);
  const home = createBacklogHome({ kind: 'global', root: graph.home.root });
  const legacyRoot = join(home.root, 'legacy');
  const source = join(legacyRoot, 'tasks/TASK-0001.md');
  mkdirSync(join(legacyRoot, 'tasks'), { recursive: true });
  const { content, ...frontmatter } = buildEntity({ id: 'TASK-0001', title: 'Legacy work', content: 'Lossless history' });
  writeFileSync(source, matter.stringify(content, frontmatter));
  const params = { home, registry: graph.registry, legacyRoot };
  const fs = createMigrationFileSystem();
  return { ...graph, home, params, fs, source, legacyRoot };
}

describe('migration plan boundary', function planBoundary() {
  it('plans deterministically with only a read port and an explicit destination snapshot', function purePlanning() {
    const { params, fs, source, home } = migrationFixture('read-only-planner');
    const reader: DocsNativeMigrationReadPort = {
      exists: fs.exists, isSymbolicLink: fs.isSymbolicLink, realpath: fs.realpath,
      canonicalize: fs.canonicalize, readDirectory: fs.readDirectory, readFile: fs.readFile,
    };
    expect(reader).not.toHaveProperty('writeFile');
    const before = readFileSync(source);
    const first = domainPlan({ ...params, fileSystem: reader, destinationDocuments: [] });
    expect(first.issues).toEqual([]);
    expect(domainPlan({ ...params, fileSystem: reader, destinationDocuments: [] })).toEqual(first);
    expect(localPlan(params)).toEqual(first);
    expect(readFileSync(source)).toEqual(before);
    expect(existsSync(join(home.documentsDir, 'tasks/TASK-0001.md'))).toBe(false);
  });

  it('rejects changed source bytes after planning without deleting the source', function changedSource() {
    const { params, fs, source, home } = migrationFixture('saved-plan-changed-source');
    const plan = localPlan(params);
    writeFileSync(source, 'Native replacement bytes');
    expect(() => executeDocsNativeMigrationPlan(plan, fs)).toThrow('source changed after planning');
    expect(readFileSync(source, 'utf8')).toBe('Native replacement bytes');
    expect(existsSync(join(home.documentsDir, 'tasks/TASK-0001.md'))).toBe(false);
  });

  it('rejects a newly occupied destination before publishing or deleting any source', function occupiedDestination() {
    const { params, fs, source, home } = migrationFixture('saved-plan-destination');
    const plan = localPlan(params);
    const target = join(home.documentsDir, 'tasks/TASK-0001.md');
    mkdirSync(join(home.documentsDir, 'tasks'), { recursive: true });
    writeFileSync(target, 'Native destination');
    expect(() => executeDocsNativeMigrationPlan(plan, fs)).toThrow('destination changed before execution');
    expect(existsSync(source)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('Native destination');
  });

  it('rejects identical-byte source symlink replacement after planning', function replacedSource() {
    const { params, fs, source, home } = migrationFixture('saved-plan-source-link');
    const plan = localPlan(params);
    const outside = join(tmpdir(), 'migration-source-link-target.md');
    writeFileSync(outside, readFileSync(source));
    unlinkSync(source);
    symlinkSync(outside, source);
    expect(() => executeDocsNativeMigrationPlan(plan, fs)).toThrow('symbolic link after planning');
    expect(existsSync(source)).toBe(true);
    expect(readFileSync(outside, 'utf8')).toContain('Lossless history');
    expect(existsSync(join(home.documentsDir, 'tasks/TASK-0001.md'))).toBe(false);
  });

  it('rejects a replaced destination directory symlink after planning', function replacedTargetDirectory() {
    const { params, fs, source, home } = migrationFixture('saved-plan-target-link');
    const plan = localPlan(params);
    const outside = join(tmpdir(), 'migration-target-link-directory');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(home.documentsDir, 'tasks'));
    expect(() => executeDocsNativeMigrationPlan(plan, fs)).toThrow('destination escapes');
    expect(existsSync(source)).toBe(true);
    expect(existsSync(join(outside, 'TASK-0001.md'))).toBe(false);
  });
  it('rejects replacement of a planned root before touching source or destination', function replacedRoot() {
    const { params, fs, home } = migrationFixture('saved-plan-root-link');
    const plan = localPlan(params);
    const moved = `${home.root}-moved`;
    const outside = `${home.root}-outside`;
    renameSync(home.root, moved);
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, home.root);
    expect(() => executeDocsNativeMigrationPlan(plan, fs)).toThrow('roots changed after planning');
    expect(readFileSync(join(moved, 'legacy/tasks/TASK-0001.md'), 'utf8')).toContain('Lossless history');
    expect(existsSync(join(outside, 'docs/tasks/TASK-0001.md'))).toBe(false);
  });

});
