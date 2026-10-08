/** Verify read-only composition and peer diagnostic presentation (ADR 0113.4). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { vol } from './helpers/virtual-fs.js';
import { createCliCorpusChecker } from '../composition/cli-corpus-checker.js';
import { registerCheck } from '../cli/commands/check.js';
import { registerBacklogCheckTool } from '../tools/backlog-check.js';
import type { CorpusCheckReport } from '../core/corpus-check.contract.js';

afterEach(function restoreIo() { vi.restoreAllMocks(); process.exitCode = 0; });

function fixture(root: string): void {
  mkdirSync(`${root}/docs/adr`, { recursive: true });
  mkdirSync(`${root}/.backlog`, { recursive: true });
  writeFileSync(`${root}/docs/adr/0001-first.md`, '---\nid: ADR 0001\ntype: adr\ntitle: First\nstatus: proposed\ndescription: First decision.\n---\n\n## Decision\nUse a small document.\n');
}

function program(): Command {
  const command = new Command().option('--json').option('--home <home>').option('--project-root <path>');
  registerCheck(command);
  return command;
}

describe('corpus check adapters', function adapters() {
  it('checks a selected home without writing any file or control state', async function readonlyComposition() {
    const root = '/corpus-check-adapters/clean';
    fixture(root);
    const before = vol.toJSON();
    const report = await createCliCorpusChecker({ home: 'project', projectRoot: root, env: {} }).check();
    expect(report.valid).toBe(true);
    expect(report.summary.entities).toBe(1);
    expect(vol.toJSON()).toEqual(before);
  });

  it('prints the report and requests exit 1 for invalid authored documents', async function violationExit() {
    const root = '/corpus-check-adapters/invalid';
    fixture(root);
    writeFileSync(`${root}/docs/adr/0001-first.md`, '---\ntype: adr\ntitle: Missing ID\nstatus: proposed\n---\n');
    const output = vi.spyOn(console, 'log').mockImplementation(function quiet() {});
    await program().parseAsync(['--home', 'project', '--project-root', root, '--json', 'check'], { from: 'user' });
    const report = JSON.parse(String(output.mock.calls[0]?.[0])) as CorpusCheckReport;
    expect(report.valid).toBe(false);
    expect(report.diagnostics.some(function missingId(diagnostic) { return diagnostic.field?.includes('id'); })).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('rejects invalid home invocation before scanning and requests exit 2', async function invalidInvocation() {
    const before = vol.toJSON();
    const error = vi.spyOn(console, 'error').mockImplementation(function quiet() {});
    await program().parseAsync(['--home', 'all', 'check'], { from: 'user' });
    expect(process.exitCode).toBe(2);
    expect(error.mock.calls[0]?.[0]).toContain('expected "global" or "project"');
    expect(vol.toJSON()).toEqual(before);
  });

  it('returns the same report through MCP without treating corpus defects as invocation errors', async function mcpReport() {
    const server = new McpServer({ name: 'checker-unit', version: '1' });
    const register = vi.spyOn(server, 'registerTool');
    const report: CorpusCheckReport = {
      version: 1, complete: true, valid: false,
      summary: { documents: 1, entities: 1, resources: 0, errors: 1, warnings: 0 },
      diagnostics: [{ code: 'invalid-entity', severity: 'error', source_path: 'adr/0001-first.md', message: 'Supply a canonical ID.' }],
    };
    registerBacklogCheckTool(server, { check: function check() { return report; } });
    const handler = register.mock.calls[0]?.[2];
    if (handler === undefined) throw new Error('Missing registered handler');
    const response = await handler({}, {} as Parameters<typeof handler>[1]);
    expect(response.isError).toBeUndefined();
    expect(response.content?.[0]).toEqual({ type: 'text', text: JSON.stringify(report, null, 2) });
    await server.close();
  });
});
