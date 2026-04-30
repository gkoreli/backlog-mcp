import type { Command } from 'commander';
import { getItems } from '../../core/get.js';
import type { GetResult } from '../../core/types.js';
import { run } from '../runner.js';

function format(result: GetResult): string {
  return result.items.map(i =>
    i.content ? `--- ${i.id} ---\n${i.content}` : `--- ${i.id} ---\n(no content)`
  ).join('\n\n');
}

export function registerGet(program: Command): void {
  program
    .command('get <ids...>')
    .description('Get one or more items by ID')
    .action((ids) => run(
      (s) => getItems(s, { ids }),
      format,
      program.opts().json,
    ));
}
