import type { Command } from 'commander';
import { getItems } from '../../core/get.js';
import type { GetResult } from '../../core/types.js';
import { cliRuntimeDependencies, run } from '../runner.js';

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
      async (runtime) => {
        const result = await getItems(runtime.service, { ids });
        // Stub→expand strong usage signal (ADR 0092.9 R-14).
        if (runtime.usageTracker !== undefined) {
          for (const item of result.items) {
            if (item.id.startsWith('MEMO-') && item.content !== null) {
              await runtime.usageTracker.recordExpand(item.id);
            }
          }
        }
        return result;
      },
      format,
      program.opts().json,
      cliRuntimeDependencies(program),
    ));
}
