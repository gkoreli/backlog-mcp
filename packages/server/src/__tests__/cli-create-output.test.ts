import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { resolveCreateContent } from '../cli/commands/create.js';
import { formatCreateResult } from '../cli/commands/create-output.js';
import { readBodyFile, readStdin } from '../cli/body-file.js';
import { cliProgramName } from '../cli/program-name.js';

describe('CLI create content sources', function describeSources() {
  it('reads --body-file through the reader', async function readsBodyFile() {
    const read = vi.fn(async function read(file: string) { return `file:${file}`; });
    await expect(resolveCreateContent({ bodyFile: '/tmp/draft.md' }, read))
      .resolves.toBe('file:/tmp/draft.md');
  });

  it('treats --source as an alias of --body-file', async function aliasSource() {
    const read = vi.fn(async function read(file: string) { return `file:${file}`; });
    await expect(resolveCreateContent({ source: '-' }, read)).resolves.toBe('file:-');
  });

  it('rejects more than one body input, like gh', async function rejectsBoth() {
    await expect(resolveCreateContent({ content: 'x', bodyFile: 'y' }, vi.fn()))
      .rejects.toThrow('Specify only one of --content, --body-file');
  });

  it('falls back to --content when no file is given', async function usesContent() {
    await expect(resolveCreateContent({ content: 'inline' }, vi.fn())).resolves.toBe('inline');
  });

  it('concatenates stdin chunks as UTF-8', async function concatenates() {
    await expect(readStdin(Readable.from(['ა', Buffer.from('b')]))).resolves.toBe('აb');
  });
});

describe('readBodyFile (gh --body-file semantics)', function describeBodyFile() {
  it('reads - from stdin', async function readsDash() {
    await expect(readBodyFile('-', async function stdin() { return 'piped'; }))
      .resolves.toBe('piped');
  });

  it('reads any user path, outside any backlog home', async function readsAnyPath() {
    writeFileSync('/draft-outside-home.md', '# draft');
    await expect(readBodyFile('/draft-outside-home.md')).resolves.toBe('# draft');
  });

  it('expands ~ to the home directory', async function expandsTilde() {
    const file = join(homedir(), 'tilde-draft.md');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(homedir(), { recursive: true });
    writeFileSync(file, 'tilde');
    await expect(readBodyFile('~/tilde-draft.md')).resolves.toBe('tilde');
  });

  it('reports missing files and directories clearly', async function reportsErrors() {
    await expect(readBodyFile('/no/such/file.md')).rejects.toThrow('File not found: /no/such/file.md');
    await expect(readBodyFile('/')).rejects.toThrow('Not a file: /');
  });
});

describe('CLI create output', function describeCreateOutput() {
  it('keeps the first line stable and names the project home and file', function formatsProject() {
    const text = formatCreateResult({
      id: 'TASK-0001',
      routed_by: 'default',
      home: 'project',
      home_id: '/work/repo',
      root: '/work/repo',
      documents_dir: '/work/repo/docs',
      display_path: '/work/repo',
      source_path: 'tasks/TASK-0001-x.md',
    });
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
      root: '/work/repo',
      documents_dir: '/elsewhere/docs',
      source_path: 'tasks/TASK-0004-y.md',
    }))
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

  it('falls back to backlog when the bin name is lost (wrapper scripts, direct runs)', function fallsBack() {
    // mise/aube and npm-on-Windows wrappers exec node on the real entry path.
    expect(cliProgramName('/opt/mise/.mise/backlog-mcp@0.76.0/node_modules/backlog-mcp/dist/cli/index.mjs')).toBe('backlog');
    expect(cliProgramName(undefined)).toBe('backlog');
  });
});
