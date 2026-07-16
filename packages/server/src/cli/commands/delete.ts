import type { Command } from 'commander';
import { deleteItem } from '../../core/delete.js';
import { cliRuntimeDependencies, run } from '../runner.js';

const CLI_DELETE_ATTRIBUTION = {
  tool: 'backlog delete',
  mutation: 'delete',
} as const;

export function registerDelete(program: Command): void {
  program
    .command('delete <id>')
    .description('Delete a backlog item')
    .requiredOption('--force', 'Confirm deletion')
    .action((id) => run(
      (runtime) => deleteItem(
        runtime.service,
        { id },
        runtime.writeContext,
        CLI_DELETE_ATTRIBUTION,
      ),
      (r) => r.deleted ? `Deleted ${r.id}` : `${r.id} not found`,
      program.opts().json,
      cliRuntimeDependencies(program),
    ));
}
