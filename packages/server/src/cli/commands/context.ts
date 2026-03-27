import type { Command } from 'commander';
import { BacklogService } from '../../storage/backlog-service.js';
import { resourceManager } from '../../resources/manager.js';
import { hydrateContext } from '../../context/index.js';
import { run } from '../runner.js';

export function registerContext(program: Command) {
  program
    .command('context [id]')
    .description('Get hydrated context for an item')
    .option('--query <text>', 'Query instead of ID')
    .option('--depth <n>', 'Traversal depth', parseInt)
    .option('--max-tokens <n>', 'Max tokens', parseInt)
    .option('--no-related', 'Skip related items')
    .option('--no-activity', 'Skip activity timeline')
    .action((id, opts) => run(
      async (s) => {
        const request: Record<string, unknown> = {};
        if (id) request.id = id;
        if (opts.query) request.query = opts.query;
        if (opts.depth) request.depth = opts.depth;
        if (opts.maxTokens) request.max_tokens = opts.maxTokens;
        if (opts.related === false) request.include_related = false;
        if (opts.activity === false) request.include_activity = false;

        return hydrateContext(request as any, {
          getTask: (tid) => s.getSync?.(tid),
          listTasks: (filter) => s.listSync?.(filter) ?? [],
          listResources: () => resourceManager.list(),
          searchUnified: (q, o) => s.searchUnified(q, o),
        });
      },
      (r) => JSON.stringify(r, null, 2),
      program.opts().json,
    ));
}
