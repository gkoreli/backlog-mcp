import type { Command } from 'commander';
import { recall } from '../../core/recall.js';
import { resolveScope } from '../../core/config.js';
import type { RecallResult } from '../../core/types.js';
import { cliRuntimeDependencies, run } from '../runner.js';

function format(result: RecallResult): string {
  if (result.items.length === 0) {
    return `No memories found for "${result.query}".`;
  }
  const lines: string[] = [`── recall: ${result.query} (${result.total}${result.truncated ? ', truncated to budget' : ''}) ──`, ''];
  for (const item of result.items) {
    const scoreStr = item.score.toFixed(3);
    const pointer = item.entity_id ? ` → ${item.entity_id}` : '';
    const kindStr = item.kind ? ` [${item.kind}]` : '';
    lines.push(`  ${scoreStr}  ${item.id}  ${item.title}${pointer}${kindStr}`);
    if (item.digest && item.digest !== item.title) lines.push(`         ${item.digest}`);
    if (item.content && item.content !== item.digest) {
      lines.push(...item.content.split('\n').map(l => `         ${l}`));
    }
    if (item.context) lines.push(`         context: ${item.context}`);
    // Provenance line (ADR 0115 R-1): weigh trust without hydrating.
    const provenance = [`${item.age_days}d old`, item.uses > 0 ? `used ${item.uses}×` : 'never used'];
    if (item.idle_days !== undefined) provenance.push(`idle ${item.idle_days}d`);
    if (item.supersedes) provenance.push(`corrects ${item.supersedes}`);
    if (item.derived) provenance.push('derived');
    lines.push(`         ${provenance.join(' · ')}  by ${item.source}`);
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
      async (runtime) => {
        // ADR 0105: explicit --context wins; else per-repo config / env default.
        const context = resolveScope({ explicit: opts.context });
        const result = await recall(
        {
          query: queryParts.join(' '),
          ...(context !== undefined ? { context } : {}),
          ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
          ...(opts.layers !== undefined ? { layers: opts.layers } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          ...(opts.full !== undefined ? { full: opts.full } : {}),
          ...(opts.budget !== undefined ? { token_budget: opts.budget } : {}),
        },
        { memoryComposer: runtime.memoryComposer },
        );
        // Recall demand log (ADR 0092.9 R-16) — weak signal, JSONL only.
        runtime.usageTracker?.recordRecall(
          queryParts.join(' '),
          result.items.map(i => i.id),
        );
        return result;
      },
      format,
      program.opts().json,
      cliRuntimeDependencies(program),
    ));
}
