import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import {
  formatDocsNativeMigrationReport,
  registerMigrateDocsNative,
} from '../cli/commands/migrate-docs-native.js';
import type {
  DocsNativeMigrationReport,
  MigrateDocsNativeParams,
} from '../core/migrate-docs-native.types.js';

function emptyReport(dryRun: boolean): DocsNativeMigrationReport {
  return {
    dryRun,
    actions: [],
    moved: 0,
    rewritten: 0,
    discarded: 0,
  };
}

function createProgram(
  migrate: (params: MigrateDocsNativeParams) => DocsNativeMigrationReport,
  options: {
    serverRunning?: (port: number) => Promise<boolean>;
    log?: (message: string) => void;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): Command {
  const program = new Command()
    .exitOverride()
    .option('--json')
    .option('--home <home>')
    .option('--project-root <path>');
  registerMigrateDocsNative(program, {
    migrate,
    serverRunning: options.serverRunning ?? (async function notRunning() {
      return false;
    }),
    log: options.log,
    env: options.env ?? {},
    cwd: '/workspace',
  });
  return program;
}

describe('docs-native migration CLI', function describeMigrationCli() {
  it('accepts the ADR command shape and performs a dry-run without a server check', async function parsesGlobalDryRun() {
    const migrate = vi.fn(function migrate(
      params: MigrateDocsNativeParams,
    ) {
      return emptyReport(params.dryRun === true);
    });
    const serverRunning = vi.fn(async function running() {
      return true;
    });
    const log = vi.fn();
    const program = createProgram(migrate, { serverRunning, log });

    await program.parseAsync([
      'node',
      'backlog',
      'migrate',
      'docs-native',
      '--home',
      'global',
      '--dry-run',
    ]);

    expect(migrate).toHaveBeenCalledWith(expect.objectContaining({
      home: expect.objectContaining({
        kind: 'global',
        controlDir: expect.stringMatching(/\/\.backlog$/u),
      }),
      dryRun: true,
    }));
    expect(serverRunning).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'Docs-native migration plan:\n  nothing to migrate',
    );
  });

  it('requires an explicit project root for project control migration', async function parsesProject() {
    const migrate = vi.fn(function migrate(
      params: MigrateDocsNativeParams,
    ) {
      return emptyReport(params.dryRun === true);
    });
    const program = createProgram(migrate);

    await expect(program.parseAsync([
      'node',
      'backlog',
      'migrate',
      'docs-native',
      '--home',
      'project',
    ])).rejects.toThrow('requires --project-root');
    expect(migrate).not.toHaveBeenCalled();
  });

  it('rejects missing/all/contradictory home selection before core', async function rejectsInvalidHomes() {
    const cases = [
      ['migrate', 'docs-native'],
      ['migrate', 'docs-native', '--home', 'all'],
      [
        'migrate',
        'docs-native',
        '--home',
        'global',
        '--project-root',
        '/workspace/project',
      ],
    ];

    for (const args of cases) {
      const migrate = vi.fn(function migrate() {
        return emptyReport(false);
      });
      await expect(createProgram(migrate).parseAsync([
        'node',
        'backlog',
        ...args,
      ])).rejects.toThrow();
      expect(migrate).not.toHaveBeenCalled();
    }
  });

  it('refuses mutation while the detached server is running', async function requiresStoppedServer() {
    const migrate = vi.fn(function migrate() {
      return emptyReport(false);
    });
    const program = createProgram(migrate, {
      serverRunning: async function running() {
        return true;
      },
    });

    await expect(program.parseAsync([
      'node',
      'backlog',
      'migrate',
      'docs-native',
      '--home',
      'global',
    ])).rejects.toThrow('Stop the backlog server');
    expect(migrate).not.toHaveBeenCalled();
  });

  it('prints the deterministic report as text or JSON', async function formatsOutput() {
    const report: DocsNativeMigrationReport = {
      dryRun: false,
      actions: [{
        kind: 'move',
        category: 'entity',
        sourcePath: 'tasks/TASK-0001.md',
        targetPath: 'docs/tasks/TASK-0001.md',
      }, {
        kind: 'discard',
        category: 'cache',
        root: 'legacy',
        path: '.cache',
      }],
      moved: 1,
      rewritten: 0,
      discarded: 1,
    };
    expect(formatDocsNativeMigrationReport(report)).toContain(
      'move tasks/TASK-0001.md -> docs/tasks/TASK-0001.md',
    );

    const log = vi.fn();
    const program = createProgram(function migrate() {
      return report;
    }, { log });
    await program.parseAsync([
      'node',
      'backlog',
      '--json',
      'migrate',
      'docs-native',
      '--home',
      'global',
    ]);
    expect(JSON.parse(log.mock.calls[0]?.[0] ?? '')).toEqual(report);
  });
});
