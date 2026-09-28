import type { Command } from 'commander';
import { editItem } from '../../core/edit.js';
import { ValidationError } from '../../core/types.js';
import type { EditOperation } from '@backlog-mcp/shared';
import type { HomeProvenance } from '../../core/home-provenance.types.js';
import type { EditResult } from '../../core/types.js';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';
import type { CliRuntime } from '../runner.types.js';
import { formatWrite } from './write-output.js';

const CLI_EDIT_ATTRIBUTION = {
  tool: 'backlog edit',
  mutation: 'resource-edit',
} as const;

/** An edit result, the edited id, and where it lives (ADR 0134.1 R4.4). */
type CliEditResult = EditResult & { id: string } & Partial<HomeProvenance>;

function formatResult(r: CliEditResult): string {
  if (!r.success) {
    // The CLI error boundary prints this and sets exit code 1 (ADR 0130 R5).
    throw new ValidationError(r.error ?? 'Edit failed');
  }
  return formatWrite(r.message ?? `Edited ${r.id}`, r);
}

function editAction(
  program: Command,
  id: string,
  operation: EditOperation,
  json: boolean,
  asAgent?: string,
) {
  return run(
    async function editInHome(runtime: CliRuntime): Promise<CliEditResult> {
      const result = await editItem(
        runtime.service,
        { id, operation },
        runtime.writeContext,
        CLI_EDIT_ATTRIBUTION,
      );
      return result.success
        ? { ...result, id, ...runtime.writeProvenance?.document(id) }
        : { ...result, id };
    },
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
