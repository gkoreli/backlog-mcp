import type { Command } from 'commander';
import { remember } from '../../core/remember.js';
import { defaultMemoryComposer, defaultUsageTracker } from '../../memory/bootstrap.js';
import { envActor } from '../../operations/logger.js';
import type { RememberResult } from '../../core/types.js';
import { run } from '../runner.js';

function format(result: RememberResult): string {
  const lines = [`remembered ${result.id} [${result.layer}] at ${result.created_at}`];
  if (result.supersedes) lines.push(`  supersedes ${result.supersedes} (predecessor expired)`);
  if (result.state_key) lines.push(`  state_key ${result.state_key} (previous holders closed)`);
  return lines.join('\n');
}

export function registerRemember(program: Command): void {
  program
    .command('remember <content...>')
    .description('Write a durable memory — a fact, procedure, or preference (ADR 0092.3 Phase C)')
    .option('--title <title>', 'Explicit title (defaults to first line of content)')
    .option('--layer <layer>', 'episodic | semantic (default) | procedural')
    .option('--context <id>', 'Scope container (e.g. FLDR-0001)')
    .option('--tags <tag...>', 'Freeform labels')
    .option('--refs <id...>', 'Source entity ids this knowledge derives from')
    .option('--kind <kind>', 'current | historical | plan | preference | timeless')
    .option('--state-key <key>', 'Evolving-fact key — closes previous holders')
    .option('--occurred-at <iso>', 'When the event occurred (ISO date)')
    .option('--valid-until <iso>', 'Expiry (ISO date)')
    .option('--supersedes <id>', 'MEMO- id this memory replaces')
    .option('--derived', 'Mark as inference (consolidator output) — requires --refs')
    .action((contentParts: string[], opts) => run(
      async () => {
        const result = await remember(
        {
          content: contentParts.join(' '),
          ...(opts.title !== undefined ? { title: opts.title } : {}),
          ...(opts.layer !== undefined ? { layer: opts.layer } : {}),
          ...(opts.context !== undefined ? { context: opts.context } : {}),
          ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
          ...(opts.refs !== undefined ? { entity_refs: opts.refs } : {}),
          ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
          ...(opts.stateKey !== undefined ? { state_key: opts.stateKey } : {}),
          ...(opts.occurredAt !== undefined ? { occurred_at: opts.occurredAt } : {}),
          ...(opts.validUntil !== undefined ? { valid_until: opts.validUntil } : {}),
          ...(opts.supersedes !== undefined ? { supersedes: opts.supersedes } : {}),
          ...(opts.derived !== undefined ? { derived: opts.derived } : {}),
        },
        { memoryComposer: defaultMemoryComposer, actorName: envActor().name },
        );
        // Citation signal (ADR 0092.9 R-14): cited MEMO- ids were useful.
        await defaultUsageTracker.recordCitations(
          [contentParts.join(' ')],
          ((opts.refs as string[] | undefined) ?? []).filter(r => r !== result.id),
        );
        return result;
      },
      format,
      program.opts().json,
    ));
}
