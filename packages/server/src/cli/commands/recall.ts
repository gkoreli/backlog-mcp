import type { Command } from 'commander';
import { recall } from '../../core/recall.js';
import { resolveContext } from '../../core/config.js';
import type { RecallParams, RecallResult } from '../../core/types.js';
import type { CrossHomeRecallResult } from '../../core/home-read-coordinator.types.js';
import { parseCommaList } from '../parse-fields.js';
import {
  cliRuntimeDependencies,
  run,
  runAcrossHomes,
} from '../runner.js';

type RecallCommandResult = RecallResult | CrossHomeRecallResult;

function format(result: RecallCommandResult): string {
  if (result.items.length === 0) {
    const lines = [`No memories found for "${result.query}".`];
    if ('homes' in result) {
      for (const home of result.homes) {
        if (!home.available) {
          lines.push(`unavailable: ${home.home_id} — ${home.reason}`);
        }
      }
    }
    return lines.join('\n');
  }
  const lines: string[] = [`── recall: ${result.query} (${result.total}${result.truncated ? ', truncated to budget' : ''}) ──`, ''];
  for (const item of result.items) {
    const scoreStr = item.score.toFixed(3);
    const pointer = item.entity_id ? ` → ${item.entity_id}` : '';
    const kindStr = item.kind ? ` [${item.kind}]` : '';
    const home = 'home_id' in item ? `[${item.home_id}] ` : '';
    lines.push(`  ${scoreStr}  ${home}${item.id}  ${item.title}${pointer}${kindStr}`);
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
  if ('homes' in result) {
    for (const home of result.homes) {
      if (!home.available) {
        lines.push(`  unavailable: ${home.home_id} — ${home.reason}`);
      }
    }
  }
  return lines.join('\n');
}

export function registerRecall(program: Command): void {
  program
    .command('recall <query...>')
    .description('Recall memories — stubs by default; --full for bodies (durable MEMO- entities since ADR 0092.3)')
    .option('--context <id>', 'Scope to memories written with this entity as their context (e.g. FLDR-0001)')
    // Comma-separated, not variadic (BUG-0004): a variadic option before
    // the variadic <query...> positional swallows the query.
    .option('--tags <tags>', 'Comma-separated tag filter, any-match (e.g. exp-1,friction)')
    .option('--layers <layers>', 'Comma-separated layers; default: all persisted layers')
    .option('--limit <n>', 'Max results', parseInt)
    .option('--full', 'Return full memory bodies instead of stubs')
    .option('--budget <tokens>', 'Approximate token budget — results packed to fit', parseInt)
    .action((queryParts: string[], opts) => {
      const deps = cliRuntimeDependencies(program);
      const tags = parseCommaList(opts.tags);
      const layers = parseCommaList(opts.layers);
      const baseParams: RecallParams = {
        query: queryParts.join(' '),
        ...(tags !== undefined ? { tags } : {}),
        ...(layers !== undefined ? { layers: layers as RecallParams['layers'] } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.full !== undefined ? { full: opts.full } : {}),
        ...(opts.budget !== undefined ? { token_budget: opts.budget } : {}),
      };
      if (deps.home === 'all') {
        const context = resolveContext({ explicit: opts.context });
        return runAcrossHomes(
            (coordinator, selection) => coordinator.recall(
              {
                ...baseParams,
                ...(context === undefined ? {} : { context }),
              },
              selection,
            ),
            format,
            program.opts().json,
            deps,
          );
      }
      return run(
            async (runtime) => {
              const context = resolveContext({
                explicit: opts.context,
                ...(runtime.home === undefined ? {} : { home: runtime.home }),
              });
              const params = {
                ...baseParams,
                ...(context === undefined ? {} : { context }),
              };
              const result = await recall(
                params,
                { memoryComposer: runtime.memoryComposer },
              );
              // Recall demand log (ADR 0092.9 R-16) — weak signal, JSONL only.
              runtime.usageTracker?.recordRecall(
                params.query,
                result.items.map(function itemId(item) {
                  return item.id;
                }),
              );
              return result;
            },
            format,
            program.opts().json,
            deps,
          );
    });
}
