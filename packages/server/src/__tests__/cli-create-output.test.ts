import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createBacklogHome } from '../core/backlog-home.js';
import {
  formatCreateResult,
  readStdin,
  resolveCreateContent,
  withCreateProvenance,
} from '../cli/commands/create.js';
import { cliProgramName } from '../cli/program-name.js';

const projectHome = createBacklogHome({ kind: 'project', root: '/work/repo' });

describe('CLI create content sources', function describeSources() {
  it('reads stdin for --source - without touching the home resolver', async function readsStdin() {
    const resolveSourcePath = vi.fn();
    const content = await resolveCreateContent(
      { source: '-' },
      { resolveSourcePath },
      async function stdin() { return '# from stdin'; },
    );
    expect(content).toBe('# from stdin');
    expect(resolveSourcePath).not.toHaveBeenCalled();
  });

  it('keeps file sources on the home-contained resolver', async function keepsContainment() {
    const resolveSourcePath = vi.fn(function resolve(path: string) { return `file:${path}`; });
    const stdin = vi.fn();
    await expect(resolveCreateContent({ source: 'notes.md' }, { resolveSourcePath }, stdin))
      .resolves.toBe('file:notes.md');
    expect(stdin).not.toHaveBeenCalled();
  });

  it('falls back to --content when no source is given', async function usesContent() {
    await expect(resolveCreateContent({ content: 'inline' }, { resolveSourcePath: vi.fn() }))
      .resolves.toBe('inline');
  });

  it('concatenates stdin chunks as UTF-8', async function concatenates() {
    await expect(readStdin(Readable.from(['ა', Buffer.from('b')]))).resolves.toBe('აb');
  });
});

describe('CLI create home provenance', function describeProvenance() {
  it('adds home fields without dropping the core result', function addsFields() {
    const result = withCreateProvenance(
      { id: 'TASK-0001', routed_by: 'default' },
      {
        home: projectHome,
        getSourcePath: function getSourcePath() {
          return '/work/repo/docs/tasks/TASK-0001-x.md';
        },
      },
    );
    expect(result).toMatchObject({
      id: 'TASK-0001',
      routed_by: 'default',
      home: 'project',
      home_id: projectHome.id,
      source_path: '/work/repo/docs/tasks/TASK-0001-x.md',
    });
  });

  it('leaves results unchanged when the runtime has no home', function noHome() {
    expect(withCreateProvenance({ id: 'TASK-0001' }, {})).toEqual({ id: 'TASK-0001' });
  });

  it('keeps the first line stable and names the project home and file', function formatsProject() {
    const text = formatCreateResult({
      id: 'TASK-0001',
      routed_by: 'default',
      home: 'project',
      home_id: '/work/repo',
      display_path: '/work/repo',
      source_path: 'tasks/TASK-0001-x.md',
    }, { root: '/work/repo', documentsDir: '/work/repo/docs' });
    expect(text.split('\n')).toEqual([
      'Created TASK-0001',
      '  project home /work/repo: docs/tasks/TASK-0001-x.md',
    ]);
  });

  it('shows paths outside the root in absolute form', function formatsOutside() {
    expect(formatCreateResult({
      id: 'TASK-0004',
      home: 'project',
      home_id: '/work/repo',
      source_path: 'tasks/TASK-0004-y.md',
    }, { root: '/work/repo', documentsDir: '/elsewhere/docs' }))
      .toBe('Created TASK-0004\n  project home /work/repo: /elsewhere/docs/tasks/TASK-0004-y.md');
  });

  it('mentions routing only when it chose a parent', function formatsRouted() {
    expect(formatCreateResult({ id: 'TASK-0005', parent_id: 'EPIC-0001', routed_by: 'session' }))
      .toBe('Created TASK-0005 in EPIC-0001 via session');
  });

  it('names the global home', function formatsGlobal() {
    expect(formatCreateResult({ id: 'TASK-0002', home: 'global', home_id: 'global' }))
      .toBe('Created TASK-0002\n  global home');
  });

  it('prints only the legacy line without provenance', function formatsLegacy() {
    expect(formatCreateResult({ id: 'TASK-0003', parent_id: 'EPIC-0001' }))
      .toBe('Created TASK-0003 in EPIC-0001');
  });
});

describe('CLI program name', function describeProgramName() {
  it('names usage after the invoked bin', function namesBin() {
    expect(cliProgramName('/usr/local/bin/backlog')).toBe('backlog');
    expect(cliProgramName('/usr/local/bin/backlog-mcp')).toBe('backlog-mcp');
  });

  it('falls back to the package name for direct entry runs', function fallsBack() {
    expect(cliProgramName('/pkg/dist/cli/index.mjs')).toBe('backlog-mcp');
    expect(cliProgramName(undefined)).toBe('backlog-mcp');
  });
});
