import type { Command } from 'commander';
import { recall } from '../../core/recall.js';
import { defaultMemoryComposer } from '../../memory/bootstrap.js';
import type { RecallResult } from '../../core/types.js';
import { run } from '../runner.js';

function format(result: RecallResult): string {
  if (result.items.length === 0) {
    return `No memories found for "${result.query}".`;
  }
  const lines: string[] = [`── recall: ${result.query} (${result.total}${result.truncated ? ', truncated to budget' : ''}) ──`, ''];
  for (const item of result.items) {
    const scoreStr = item.score.toFixed(3);
    const pointer = item.entity_id ? ` → ${item.entity_id}` : '';
    const kindStr = item.kind ? ` [${item.kind}]` : '';
    lines.push(`  ${scoreStr}  ${item.id}  ${item.digest}${pointer}${kindStr}`);
    if (item.content && item.content !== item.digest) {
      lines.push(...item.content.split('\n').map(l => `         ${l}`));
    }
    if (item.context) lines.push(`         context: ${item.context}`);
    lines.push(`         ${item.created_at}  by ${item.source}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function registerRecall(program: Command): void {
  program
    .command('recall <query...>')
    .description('Recall memories — stubs by default; --full for bodies (durable MEMO- entities since ADR 0092.3)')
    .option('--context <id>', 'Scope to memories written with this entity as their context (e.g. FLDR-0001)')
    .option('--tags <tag...>', 'Filter by tags (any-match)')
    .option('--layers <layer...>', 'Restrict to specific layers; default: all persisted layers')
    .option('--limit <n>', 'Max results', parseInt)
    .option('--full', 'Return full memory bodies instead of stubs')
    .option('--budget <tokens>', 'Approximate token budget — results packed to fit', parseInt)
    .action((queryParts: string[], opts) => run(
      () => recall(
        {
          query: queryParts.join(' '),
          ...(opts.context !== undefined ? { context: opts.context } : {}),
          ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
          ...(opts.layers !== undefined ? { layers: opts.layers } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          ...(opts.full !== undefined ? { full: opts.full } : {}),
          ...(opts.budget !== undefined ? { token_budget: opts.budget } : {}),
        },
        { memoryComposer: defaultMemoryComposer },
      ),
      format,
      program.opts().json,
    ));
}
