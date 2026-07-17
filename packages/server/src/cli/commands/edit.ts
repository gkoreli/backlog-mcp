import type { Command } from 'commander';
import { editItem } from '../../core/edit.js';
import type { EditOperation } from '@backlog-mcp/shared';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';

const CLI_EDIT_ATTRIBUTION = {
  tool: 'backlog edit',
  mutation: 'resource-edit',
} as const;

function formatResult(r: { success: boolean; message?: string; error?: string }) {
  if (!r.success) {
    console.error(r.error ?? 'Edit failed');
    process.exit(1);
  }
  return r.message ?? 'Done';
}

function editAction(
  program: Command,
  id: string,
  operation: EditOperation,
  json: boolean,
  asAgent?: string,
) {
  return run(
    (runtime) => editItem(
      runtime.service,
      { id, operation },
      runtime.writeContext,
      CLI_EDIT_ATTRIBUTION,
    ),
    formatResult,
    json,
    withAgentIdentity(cliRuntimeDependencies(program), asAgent),
  );
}

const AS_AGENT_DESCRIPTION =
  'Attribute this write to an agent identity — an AGENT- doc id or declared principal (e.g. aime:granite). Optional per-call override; usually implicit via git config backlog.agent or BACKLOG_AGENT (ADR 0119.1)';

export function registerEdit(program: Command): void {
  const edit = program
    .command('edit')
    .description('Edit an item body (use a subcommand: replace, append, insert)');

  edit
    .command('replace <id> <old> <new>')
    .description('Replace text in body')
    .option('--as <agent>', AS_AGENT_DESCRIPTION)
    .action((id: string, old_str: string, new_str: string, opts: { as?: string }) =>
      editAction(program, id, { type: 'str_replace', old_str, new_str }, program.opts().json, opts.as));

  edit
    .command('append <id> <text>')
    .description('Append text to body')
    .option('--as <agent>', AS_AGENT_DESCRIPTION)
    .action((id: string, text: string, opts: { as?: string }) =>
      editAction(program, id, { type: 'append', new_str: text }, program.opts().json, opts.as));

  edit
    .command('insert <id> <line> <text>')
    .description('Insert text at line number')
    .option('--as <agent>', AS_AGENT_DESCRIPTION)
    .action((id: string, line: string, text: string, opts: { as?: string }) =>
      editAction(program, id, { type: 'insert', insert_line: parseInt(line), new_str: text }, program.opts().json, opts.as));
}
