import type { Command } from 'commander';
import { recall } from '../../core/recall.js';
import { defaultMemoryComposer } from '../../memory/bootstrap.js';
import type { RecallResult } from '../../core/types.js';
import { run } from '../runner.js';

function format(result: RecallResult): string {
  if (result.items.length === 0) {
    return `No memories found for "${result.query}".`;
  }
  const lines: string[] = [`── recall: ${result.query} (${result.total}) ──`, ''];
  for (const item of result.items) {
    const scoreStr = item.score.toFixed(3);
    const pointer = item.entity_id ? ` → ${item.entity_id}` : '';
    const kindStr = item.kind ? ` [${item.kind}]` : '';
    lines.push(`  ${scoreStr}  ${item.content}${pointer}${kindStr}`);
    if (item.context) lines.push(`         context: ${item.context}`);
    lines.push(`         ${item.created_at}  by ${item.source}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function registerRecall(program: Command): void {
  program
    .command('recall <query...>')
    .description('Recall episodic memories (task completions + artifact creations captured in this process)')
    .option('--context <id>', 'Scope to memories written with this entity as their context (e.g. FLDR-0001)')
    .option('--tags <tag...>', 'Filter by tags (any-match)')
    .option('--layers <layer...>', 'Restrict to specific layers; default: episodic')
    .option('--limit <n>', 'Max results', parseInt)
    .action((queryParts: string[], opts) => run(
      () => recall(
        {
          query: queryParts.join(' '),
          ...(opts.context !== undefined ? { context: opts.context } : {}),
          ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
          ...(opts.layers !== undefined ? { layers: opts.layers } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        },
        { memoryComposer: defaultMemoryComposer },
      ),
      format,
      program.opts().json,
    ));
}
