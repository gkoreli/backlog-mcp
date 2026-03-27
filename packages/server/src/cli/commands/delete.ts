import type { Command } from 'commander';
import { deleteItem } from '../../core/delete.js';
import { run } from '../runner.js';

export function registerDelete(program: Command) {
  program
    .command('delete <id>')
    .description('Delete a backlog item')
    .requiredOption('--force', 'Confirm deletion')
    .action((id) => run(
      (s) => deleteItem(s, { id }),
      (r) => r.deleted ? `Deleted ${r.id}` : `${r.id} not found`,
      program.opts().json,
    ));
}
