import type { Command } from 'commander';
import { getItems } from '../../core/get.js';
import type { GetResult } from '../../core/types.js';
import { defaultUsageTracker } from '../../memory/bootstrap.js';
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
      async (s) => {
        const result = await getItems(s, { ids });
        // Stub→expand strong usage signal (ADR 0092.9 R-14).
        for (const item of result.items) {
          if (item.id.startsWith('MEMO-') && item.content !== null) {
            await defaultUsageTracker.recordExpand(item.id);
          }
        }
        return result;
      },
      format,
      program.opts().json,
    ));
}
