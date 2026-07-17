import type { Command } from 'commander';
import { deleteItem } from '../../core/delete.js';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';

const CLI_DELETE_ATTRIBUTION = {
  tool: 'backlog delete',
  mutation: 'delete',
} as const;

export function registerDelete(program: Command): void {
  program
    .command('delete <id>')
    .description('Delete a backlog item')
    .requiredOption('--force', 'Confirm deletion')
    .option('--as <agent>', 'Attribute this write to an agent identity — an AGENT- doc id or declared principal (e.g. aime:granite). Optional per-call override; usually implicit via git config backlog.agent or BACKLOG_AGENT (ADR 0119.1)')
    .action((id, opts) => run(
      (runtime) => deleteItem(
        runtime.service,
        { id },
        runtime.writeContext,
        CLI_DELETE_ATTRIBUTION,
      ),
      (r) => r.deleted ? `Deleted ${r.id}` : `${r.id} not found`,
      program.opts().json,
      withAgentIdentity(cliRuntimeDependencies(program), opts.as),
    ));
}
