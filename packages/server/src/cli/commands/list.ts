import type { Command } from 'commander';
import { listItems } from '../../core/list.js';
import type { ListResult } from '../../core/types.js';
import { run } from '../runner.js';

function format(result: ListResult): string {
  if (result.tasks.length === 0) return 'No items found.';
  const lines = result.tasks.map(t =>
    `${t.id.padEnd(12)} ${(t.status ?? '-').padEnd(14)} ${t.type.padEnd(8)} ${t.title}`
  );
  if (result.counts) {
    lines.push('', `Total: ${result.counts.total_tasks} tasks, ${result.counts.total_epics} epics`);
  }
  return lines.join('\n');
}

export function registerList(program: Command) {
  program
    .command('list')
    .description('List backlog items')
    .option('--status <status...>', 'Filter by status')
    .option('--type <type>', 'Filter by type')
    .option('--epic <id>', 'Filter by epic')
    .option('--parent <id>', 'Filter by parent')
    .option('--query <text>', 'Search across fields')
    .option('--counts', 'Include counts')
    .option('--limit <n>', 'Max items', parseInt)
    .action((opts) => run(
      (s) => listItems(s, {
        status: opts.status,
        type: opts.type,
        epic_id: opts.epic,
        parent_id: opts.parent,
        query: opts.query,
        counts: opts.counts,
        limit: opts.limit,
      }),
      format,
      program.opts().json,
    ));
}
