import type { Command } from 'commander';
import { deleteItem } from '../../core/delete.js';
import { cliRuntimeDependencies, run } from '../runner.js';

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
      ),
      (r) => r.deleted ? `Deleted ${r.id}` : `${r.id} not found`,
      program.opts().json,
      cliRuntimeDependencies(program),
    ));
}
