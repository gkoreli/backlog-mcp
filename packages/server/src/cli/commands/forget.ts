import type { Command } from 'commander';
import { forget } from '../../core/forget.js';
import { defaultMemoryComposer } from '../../memory/bootstrap.js';
import type { ForgetResult } from '../../core/types.js';
import { run } from '../runner.js';

function format(result: ForgetResult): string {
  return result.forgotten === 0
    ? 'No memories matched — nothing forgotten.'
    : `Forgot ${result.forgotten} memor${result.forgotten === 1 ? 'y' : 'ies'} (soft-expired; still auditable in the viewer).`;
}

export function registerForget(program: Command): void {
  program
    .command('forget')
    .description('Retract memories — soft-expire (drops from recall, stays auditable). --expired hard-deletes already-expired (GC).')
    .option('--ids <id...>', 'Specific MEMO- ids')
    .option('--context <id>', 'All memories scoped to this context')
    .option('--layer <layer>', 'episodic | semantic | procedural')
    .option('--older-than <iso>', 'Memories created before this ISO date')
    .option('--expired', 'GC: hard-delete already-expired memories')
    .action((opts) => run(
      () => forget(
        {
          ...(opts.ids !== undefined ? { ids: opts.ids } : {}),
          ...(opts.context !== undefined ? { context: opts.context } : {}),
          ...(opts.layer !== undefined ? { layer: opts.layer } : {}),
          ...(opts.olderThan !== undefined ? { older_than: opts.olderThan } : {}),
          ...(opts.expired !== undefined ? { expired: opts.expired } : {}),
        },
        { memoryComposer: defaultMemoryComposer },
      ),
      format,
      program.opts().json,
    ));
}
