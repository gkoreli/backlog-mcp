import type { Command } from 'commander';
import { searchItems } from '../../core/search.js';
import type { SearchResult } from '../../core/types.js';
import { run } from '../runner.js';

function format(result: SearchResult): string {
  if (result.results.length === 0) return `No results for "${result.query}"`;
  const lines = result.results.map(r => {
    let line = `${(r.id ?? r.path ?? '').padEnd(12)} ${r.type.padEnd(8)} ${r.title}`;
    if (r.snippet) line += `\n  ${r.snippet}`;
    return line;
  });
  lines.push('', `${result.total} results (${result.search_mode})`);
  return lines.join('\n');
}

export function registerSearch(program: Command) {
  program
    .command('search <query>')
    .description('Search backlog items')
    .option('--types <types...>', 'Filter by type (task, epic, resource)')
    .option('--status <status...>', 'Filter by status')
    .option('--sort <mode>', 'Sort: relevant or recent')
    .option('--limit <n>', 'Max results', parseInt)
    .option('--content', 'Include full content')
    .option('--scores', 'Include relevance scores')
    .action((query, opts) => run(
      (s) => searchItems(s, {
        query,
        types: opts.types,
        status: opts.status,
        sort: opts.sort,
        limit: opts.limit,
        include_content: opts.content,
        include_scores: opts.scores,
      }),
      format,
      program.opts().json,
    ));
}
