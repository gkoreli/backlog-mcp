import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Entity } from '@backlog-mcp/shared';
import { describe, expect, it } from 'vitest';
import {
  createBacklogHome,
  resolveBacklogHome,
} from '../core/backlog-home.js';
import {
  assertDocsNativeMigrationComplete,
  DocsNativeMigrationError,
  migrateDocsNative,
  planDocsNativeMigration,
} from '../core/migrate-docs-native.js';
import {
  createBuiltinSubstrateRegistrations,
  loadProjectSubstrateDefinitions,
  type ProjectSubstrateRegistry,
} from '../core/substrates/index.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import { DocsNativeFilesystemStorage } from '../storage/local/docs-native-filesystem-storage.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';

const TIMESTAMP = '2026-07-16T00:00:00.000Z';

function globalHome(name: string) {
  return resolveBacklogHome({
    home: 'global',
    globalRoot: join(tmpdir(), 'migrate-docs-native', name),
    env: {},
  });
}

function projectHome(name: string) {
  return createBacklogHome({
    kind: 'project',
    root: join(tmpdir(), 'migrate-docs-native', name),
  });
}

function registry(): ProjectSubstrateRegistry {
  const catalog = new BuiltinSubstrateStorageCatalog();
  return loadProjectSubstrateDefinitions(
    [],
    createBuiltinSubstrateRegistrations(catalog),
  ).registry;
}

function entity(
  id: string,
  type: Entity['type'],
  overrides: Partial<Entity> = {},
): Entity {
  const base = {
    id,
    type,
    title: `${type} ${id}`,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...(type === 'memory'
      ? { content: 'Remember the migration', layer: 'semantic' as const }
      : { status: 'open' as const }),
    ...overrides,
  };
  return base as Entity;
}

function writeLegacyEntity(
  root: string,
  value: Entity,
  options: { omitType?: boolean } = {},
): string {
  const path = join(root, 'tasks', `${value.id}.md`);
  const { content, ...frontmatter } = value;
  if (options.omitType) delete (frontmatter as Partial<Entity>).type;
  mkdirSync(join(root, 'tasks'), { recursive: true });
  writeFileSync(
    path,
    matter.stringify(content ?? '', frontmatter),
  );
  return path;
}

describe('docs-native global migration', function describeGlobalMigration() {
  it('produces a deterministic dry-run without changing legacy data', function dryRun() {
    const home = globalHome('dry-run');
    writeLegacyEntity(home.root, entity('TASK-0001', 'task'), {
      omitType: true,
    });
    writeLegacyEntity(home.root, entity('EPIC-0001', 'epic'));
    writeLegacyEntity(home.root, entity('MEMO-0001', 'memory'));
    mkdirSync(join(home.root, 'resources', 'nested'), { recursive: true });
    writeFileSync(join(home.root, 'resources', 'nested', 'guide.txt'), 'guide');
    writeFileSync(join(home.root, 'identity.md'), 'quartz');
    mkdirSync(join(home.root, '.internal'), { recursive: true });
    writeFileSync(join(home.root, '.internal', 'operations.jsonl'), '{"op":1}\n');
    writeFileSync(join(home.root, '.internal', 'cursor.json'), '{"cursor":1}\n');
    writeFileSync(join(home.root, 'memory-usage.jsonl'), '{"usage":1}\n');
    mkdirSync(join(home.root, 'logs'), { recursive: true });
    writeFileSync(join(home.root, 'logs', 'server.log'), 'legacy log\n');
    mkdirSync(join(home.root, '.cache'), { recursive: true });
    writeFileSync(join(home.root, '.cache', 'search-index.json'), 'legacy cache');
    mkdirSync(join(home.root, 'cache'), { recursive: true });
    writeFileSync(join(home.root, 'cache', 'search-index.json'), 'new cache');
    mkdirSync(join(home.root, '.backlog-mcp', 'state'), { recursive: true });
    writeFileSync(
      join(home.root, '.backlog-mcp', 'state', 'checkpoint.jsonl'),
      '{"checkpoint":1}\n',
    );

    const report = migrateDocsNative({
      home,
      registry: registry(),
      dryRun: true,
    });
    const movePairs = report.actions.flatMap(function movePair(action) {
      return action.kind === 'move'
        ? [`${action.sourcePath} -> ${action.targetPath}`]
        : [];
    });

    expect(report).toMatchObject({
      dryRun: true,
      moved: 0,
      discarded: 0,
    });
    const expectedMoves = [
      '.backlog-mcp/state/checkpoint.jsonl -> state/checkpoint.jsonl',
      '.internal/cursor.json -> state/legacy-internal/cursor.json',
      '.internal/operations.jsonl -> state/operations.jsonl',
      'EPIC-0001.md -> docs/epics/EPIC-0001.md',
      'identity.md -> docs/identity.md',
      'logs/server.log -> state/logs/server.log',
      'memory-usage.jsonl -> state/memory-usage.jsonl',
      'MEMO-0001.md -> docs/memories/MEMO-0001.md',
      'resources/nested/guide.txt -> docs/resources/nested/guide.txt',
      'TASK-0001.md -> docs/tasks/TASK-0001.md',
    ].map(function qualifyLegacyTaskSource(pair) {
      return /^(?:EPIC|MEMO|TASK)-/u.test(pair) ? `tasks/${pair}` : pair;
    });
    expect(movePairs).toEqual(expect.arrayContaining(expectedMoves));
    expect(planDocsNativeMigration({
      home,
      registry: registry(),
    }).actions).toEqual(report.actions);
    expect(report.actions.filter(function isDiscard(action) {
      return action.kind === 'discard';
    })).toEqual([
      {
        kind: 'discard',
        category: 'cache',
        root: 'home',
        path: 'cache',
      },
      {
        kind: 'discard',
        category: 'cache',
        root: 'legacy',
        path: '.cache',
      },
    ]);
    expect(readFileSync(join(home.root, 'tasks', 'TASK-0001.md'), 'utf-8'))
      .toContain('task TASK-0001');
    expect(existsSync(join(home.root, 'docs', 'tasks', 'TASK-0001.md')))
      .toBe(false);
  });

  it('moves bytes only after preflight and becomes an idempotent no-op', function migrates() {
    const home = globalHome('success');
    const taskPath = writeLegacyEntity(
      home.root,
      entity('TASK-0001', 'task', { content: '## Exact bytes\n' }),
    );
    const taskBytes = readFileSync(taskPath);
    mkdirSync(join(home.root, 'resources'), { recursive: true });
    const resourceBytes = Buffer.from([0, 1, 2, 255]);
    writeFileSync(join(home.root, 'resources', 'binary.dat'), resourceBytes);
    mkdirSync(join(home.root, '.cache'), { recursive: true });
    writeFileSync(join(home.root, '.cache', 'search-index.json'), 'stale');

    const report = migrateDocsNative({
      home,
      registry: registry(),
    });

    expect(report).toMatchObject({
      dryRun: false,
      moved: 2,
      discarded: 1,
    });
    expect(readFileSync(join(home.documentsDir, 'tasks', 'TASK-0001.md')))
      .toEqual(taskBytes);
    expect(readFileSync(join(home.documentsDir, 'resources', 'binary.dat')))
      .toEqual(resourceBytes);
    expect(existsSync(join(home.root, 'tasks'))).toBe(false);
    expect(existsSync(join(home.root, 'resources'))).toBe(false);
    expect(existsSync(join(home.root, '.cache'))).toBe(false);

    const storage = new DocsNativeFilesystemStorage(home, registry());
    expect(storage.get('TASK-0001')).toMatchObject({
      id: 'TASK-0001',
      title: 'task TASK-0001',
    });
    expect(migrateDocsNative({
      home,
      registry: registry(),
    })).toMatchObject({
      moved: 0,
      rewritten: 0,
      discarded: 0,
      actions: [],
    });
  });

  it('merges the global config overlay and renames scope to context', function migratesGlobalConfig() {
    const home = globalHome('global-config');
    mkdirSync(home.root, { recursive: true });
    writeFileSync(
      join(home.root, 'config.json'),
      '{"scope":"FLDR-BASE","home":"global","value":"base"}\n',
    );
    writeFileSync(
      join(home.root, 'config.local.json'),
      '{"scope":"FLDR-LOCAL","value":"local"}\n',
    );

    expect(migrateDocsNative({
      home,
      registry: registry(),
    })).toMatchObject({
      moved: 1,
      rewritten: 1,
    });
    expect(JSON.parse(readFileSync(
      join(home.root, 'config.json'),
      'utf-8',
    ))).toEqual({
      context: 'FLDR-LOCAL',
      home: 'global',
      value: 'local',
    });
    expect(existsSync(join(home.root, 'config.local.json'))).toBe(false);
  });

  it('routes packaged substrate entities through the compiled catalog', function migratesPackagedSubstrate() {
    const home = globalHome('packaged-substrate');
    mkdirSync(join(home.root, 'tasks'), { recursive: true });
    writeFileSync(
      join(home.root, 'tasks', 'REQ-0001.md'),
      matter.stringify('The repo owns its truth.', {
        id: 'REQ-0001',
        type: 'requirement',
        title: 'Docs are truth',
        status: 'intake',
        compliance: 'unchecked',
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      }),
    );

    migrateDocsNative({
      home,
      registry: registry(),
    });

    expect(readFileSync(
      join(home.documentsDir, 'requirements', 'REQ-0001.md'),
      'utf-8',
    )).toContain('The repo owns its truth.');
  });

  it('fails closed when one config declares both old and new context keys', function rejectsAmbiguousConfig() {
    const home = globalHome('ambiguous-config');
    mkdirSync(home.root, { recursive: true });
    writeFileSync(
      join(home.root, 'config.json'),
      '{"scope":"FLDR-OLD","context":"FLDR-NEW"}\n',
    );

    const plan = planDocsNativeMigration({
      home,
      registry: registry(),
    });

    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-config',
        sourcePaths: ['config.json'],
      }),
    ]);
  });

  it('refuses exact and semantic identity collisions before mutation', function collisions() {
    const exactHome = globalHome('exact-collision');
    const exactSource = writeLegacyEntity(
      exactHome.root,
      entity('TASK-0001', 'task'),
    );
    mkdirSync(join(exactHome.documentsDir, 'tasks'), { recursive: true });
    writeFileSync(
      join(exactHome.documentsDir, 'tasks', 'TASK-0001.md'),
      'existing',
    );

    expect(function migrateExactCollision() {
      migrateDocsNative({
        home: exactHome,
        registry: registry(),
      });
    }).toThrow(DocsNativeMigrationError);
    expect(existsSync(exactSource)).toBe(true);

    const semanticHome = globalHome('semantic-collision');
    const semanticSource = writeLegacyEntity(
      semanticHome.root,
      entity('TASK-00001', 'task'),
    );
    mkdirSync(join(semanticHome.documentsDir, 'tasks'), { recursive: true });
    writeFileSync(
      join(semanticHome.documentsDir, 'tasks', 'TASK-0001-existing.md'),
      matter.stringify('', entity('TASK-0001', 'task')),
    );
    const semanticPlan = planDocsNativeMigration({
      home: semanticHome,
      registry: registry(),
    });

    expect(semanticPlan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'identity-collision',
        sourcePaths: [
          'tasks/TASK-00001.md',
          'tasks/TASK-0001-existing.md',
        ],
      }),
    ]));
    expect(existsSync(semanticSource)).toBe(true);
    expect(existsSync(
      join(semanticHome.documentsDir, 'tasks', 'TASK-00001.md'),
    )).toBe(false);
  });

  it('rolls back created targets when a later copy fails', function rollsBack() {
    const home = globalHome('rollback');
    mkdirSync(join(home.root, 'resources'), { recursive: true });
    writeFileSync(join(home.root, 'resources', 'a.txt'), 'a');
    writeFileSync(join(home.root, 'resources', 'b.txt'), 'b');
    let writes = 0;

    expect(function failSecondCopy() {
      migrateDocsNative({
        home,
        registry: registry(),
        fileSystem: {
          writeFileExclusive(path, content) {
            writes += 1;
            if (writes === 2) throw new Error('injected copy failure');
            writeFileSync(path, content, { flag: 'wx' });
          },
        },
      });
    }).toThrow('injected copy failure');

    expect(readFileSync(join(home.root, 'resources', 'a.txt'), 'utf-8')).toBe('a');
    expect(readFileSync(join(home.root, 'resources', 'b.txt'), 'utf-8')).toBe('b');
    expect(existsSync(join(home.documentsDir, 'resources', 'a.txt'))).toBe(false);
    expect(existsSync(join(home.documentsDir, 'resources', 'b.txt'))).toBe(false);
  });

  it('fails closed on malformed entities and source symlinks', function rejectsUnsafeSources() {
    const malformedHome = globalHome('malformed');
    mkdirSync(join(malformedHome.root, 'tasks'), { recursive: true });
    writeFileSync(
      join(malformedHome.root, 'tasks', 'TASK-0001.md'),
      '---\ntitle: broken: yaml\n---\n',
    );
    expect(function migrateMalformed() {
      migrateDocsNative({
        home: malformedHome,
        registry: registry(),
      });
    }).toThrow(DocsNativeMigrationError);

    const symlinkHome = globalHome('symlink');
    mkdirSync(join(symlinkHome.root, 'resources'), { recursive: true });
    const outside = join(tmpdir(), 'migrate-docs-native-outside.txt');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(symlinkHome.root, 'resources', 'outside.txt'));
    const plan = planDocsNativeMigration({
      home: symlinkHome,
      registry: registry(),
    });
    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: 'unsupported-source',
        sourcePaths: ['resources/outside.txt'],
      }),
    ]);
  });

  it('blocks global runtime construction until the explicit migration runs', function guardsGlobalRuntime() {
    const home = globalHome('runtime-guard');
    mkdirSync(join(home.root, 'tasks'), { recursive: true });

    expect(function constructBeforeMigration() {
      createLocalRuntime(home);
    }).toThrow('backlog migrate docs-native --home global');

    migrateDocsNative({ home, registry: registry() });
    expect(function verifyAfterMigration() {
      assertDocsNativeMigrationComplete(home);
    }).not.toThrow();
  });
});

describe('docs-native project control migration', function describeProjectMigration() {
  it('renames only explicit tool-owned control state and is idempotent', function migratesProjectControl() {
    const home = projectHome('project-success');
    const legacyControl = join(home.root, '.backlog-mcp');
    mkdirSync(join(legacyControl, 'state'), { recursive: true });
    mkdirSync(join(legacyControl, 'cache'), { recursive: true });
    writeFileSync(join(legacyControl, 'state', 'usage.jsonl'), 'usage\n');
    writeFileSync(join(legacyControl, 'cache', 'search.json'), 'cache');
    writeFileSync(
      join(legacyControl, 'config.json'),
      '{"home":"project","scope":"FLDR-BASE"}\n',
    );
    writeFileSync(
      join(legacyControl, 'config.local.json'),
      '{"scope":"FLDR-LOCAL"}\n',
    );

    expect(migrateDocsNative({
      home,
      registry: registry(),
    })).toMatchObject({
      moved: 3,
      rewritten: 2,
      discarded: 1,
    });
    expect(readFileSync(join(home.controlDir, 'state', 'usage.jsonl'), 'utf-8'))
      .toBe('usage\n');
    expect(JSON.parse(readFileSync(
      join(home.controlDir, 'config.json'),
      'utf-8',
    ))).toEqual({
      home: 'project',
      context: 'FLDR-BASE',
    });
    expect(JSON.parse(readFileSync(
      join(home.controlDir, 'config.local.json'),
      'utf-8',
    ))).toEqual({
      context: 'FLDR-LOCAL',
    });
    expect(existsSync(legacyControl)).toBe(false);
    expect(existsSync(join(home.controlDir, 'cache'))).toBe(false);
    expect(migrateDocsNative({
      home,
      registry: registry(),
    })).toMatchObject({
      actions: [],
      moved: 0,
      rewritten: 0,
      discarded: 0,
    });
  });

  it('rewrites context keys in an already-renamed project control directory', function rewritesCurrentProjectConfig() {
    const home = projectHome('project-current-config');
    mkdirSync(home.controlDir, { recursive: true });
    writeFileSync(
      join(home.controlDir, 'config.json'),
      '{"scope":"FLDR-CURRENT"}\n',
    );

    expect(migrateDocsNative({
      home,
      registry: registry(),
    })).toMatchObject({
      moved: 0,
      rewritten: 1,
    });
    expect(JSON.parse(readFileSync(
      join(home.controlDir, 'config.json'),
      'utf-8',
    ))).toEqual({
      context: 'FLDR-CURRENT',
    });
  });

  it('refuses both control directories or non-tool-owned legacy files', function refusesAmbiguity() {
    const ambiguousHome = projectHome('project-ambiguous');
    mkdirSync(join(ambiguousHome.root, '.backlog-mcp', 'state'), {
      recursive: true,
    });
    mkdirSync(ambiguousHome.controlDir, { recursive: true });
    const ambiguousPlan = planDocsNativeMigration({
      home: ambiguousHome,
      registry: registry(),
    });
    expect(ambiguousPlan.issues).toEqual([
      expect.objectContaining({ code: 'ambiguous-control-layout' }),
    ]);

    const unsupportedHome = projectHome('project-unsupported');
    mkdirSync(join(unsupportedHome.root, '.backlog-mcp'), { recursive: true });
    writeFileSync(
      join(unsupportedHome.root, '.backlog-mcp', '.gitignore'),
      'state/\n',
    );
    const unsupportedPlan = planDocsNativeMigration({
      home: unsupportedHome,
      registry: registry(),
    });
    expect(unsupportedPlan.issues).toEqual([
      expect.objectContaining({
        code: 'unsupported-source',
        sourcePaths: ['.backlog-mcp/.gitignore'],
      }),
    ]);
  });

  it('blocks project runtime construction until its explicit control migration runs', function guardsProjectRuntime() {
    const home = projectHome('project-runtime-guard');
    mkdirSync(join(home.root, '.backlog-mcp', 'state'), { recursive: true });

    expect(function constructBeforeMigration() {
      createLocalRuntime(home);
    }).toThrow('backlog migrate docs-native --home project');
  });
});
