import type { Command } from 'commander';
import { searchItems } from '../../core/search.js';
import type { SearchParams, SearchResult } from '../../core/types.js';
import type { CrossHomeSearchResult } from '../../core/home-read-coordinator.types.js';
import {
  cliRuntimeDependencies,
  run,
  runAcrossHomes,
} from '../runner.js';

type SearchCommandResult = SearchResult | CrossHomeSearchResult;

function format(result: SearchCommandResult): string {
  if (result.results.length === 0) {
    const lines = [`No results for "${result.query}"`];
    if ('homes' in result) {
      for (const home of result.homes) {
        if (!home.available) {
          lines.push(`unavailable: ${home.home_id} — ${home.reason}`);
        }
      }
    }
    return lines.join('\n');
  }
  const lines = result.results.map(r => {
    const home = 'home_id' in r ? `[${r.home_id}] ` : '';
    // Declared status is part of the stub (BUG-0003) — same [status] shape
    // as wakeup section stubs.
    const status = r.status ? `[${r.status}] ` : '';
    let line = `${home}${(r.id ?? r.path ?? '').padEnd(12)} ${r.type.padEnd(8)} ${status}${r.title}`;
    if (r.snippet) line += `\n  ${r.snippet}`;
    return line;
  });
  lines.push('', `${result.total} results (${result.search_mode})`);
  if ('homes' in result) {
    for (const home of result.homes) {
      if (!home.available) {
        lines.push(`unavailable: ${home.home_id} — ${home.reason}`);
      }
    }
  }
  return lines.join('\n');
}

export function registerSearch(program: Command): void {
  program
    .command('search <query>')
    .description('Search backlog items')
    .option('--types <types...>', 'Filter by substrate type or resource')
    .option('--status <status...>', 'Filter by status')
    .option('--sort <mode>', 'Sort: relevant or recent')
    .option('--limit <n>', 'Max results', parseInt)
    .option('--content', 'Include full content')
    .option('--scores', 'Include relevance scores')
    .action((query, opts) => {
      const deps = cliRuntimeDependencies(program);
      const params: SearchParams = {
        query,
        types: opts.types,
        status: opts.status,
        sort: opts.sort,
        limit: opts.limit,
        include_content: opts.content,
        include_scores: opts.scores,
      };
      return deps.home === 'all'
        ? runAcrossHomes(
            (coordinator, selection) => coordinator.search(
              params,
              selection,
            ),
            format,
            program.opts().json,
            deps,
          )
        : run(
            async (runtime) => {
              const result = await searchItems(runtime.service, params);
              // Tier-1 telemetry (ADR 0121 R7) — returned ids only,
              // fail-open; never query text (Tier 2, gated separately).
              runtime.usageTracker?.recordSearch(
                result.results.map(function resultId(item) {
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
