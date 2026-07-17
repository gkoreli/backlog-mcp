import type { Command } from 'commander';
import { updateEntity } from '../../core/update.js';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';
import { parseFields } from '../parse-fields.js';

const CLI_UPDATE_ATTRIBUTION = {
  tool: 'backlog update',
  mutation: 'update',
} as const;

export function registerUpdate(program: Command): void {
  program
    .command('update <id>')
    .description('Update a backlog item')
    .option('--title <text>', 'New title')
    .option('--status <status>', 'New status')
    .option('--parent <id>', 'Set parent (use "" to clear)')
    .option('--evidence <text...>', 'Evidence entries')
    .option('--blocked-reason <text...>', 'Blocked reasons')
    .option('--due-date <date>', 'Due date (use "" to clear)')
    .option('--fields <json-object>', 'Low-level substrate-specific fields as a JSON object')
    .option('--as <agent>', 'Attribute this write to an agent identity — an AGENT- doc id or declared principal (e.g. aime:granite). Optional; also via BACKLOG_AGENT env (ADR 0119)')
    .action((id, opts) => run(
      (runtime) => updateEntity(
        runtime.service,
        {
          id,
          title: opts.title,
          status: opts.status,
          parent_id: opts.parent === '' ? null : opts.parent,
          evidence: opts.evidence,
          blocked_reason: opts.blockedReason,
          due_date: opts.dueDate === '' ? null : opts.dueDate,
          fields: parseFields(opts.fields),
        },
        runtime.writeContext,
        CLI_UPDATE_ATTRIBUTION,
      ),
      (r) => `Updated ${r.id}`,
      program.opts().json,
      withAgentIdentity(cliRuntimeDependencies(program), opts.as),
    ));
}
