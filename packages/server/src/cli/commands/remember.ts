import type { Command } from 'commander';
import { remember } from '../../core/remember.js';
import { findCollisionCandidatesForMemory } from '../../core/collision-candidates.js';
import { resolveContext } from '../../core/config.js';
import type { RememberResult } from '../../core/types.js';
import { parseCommaList } from '../parse-fields.js';
import { cliRuntimeDependencies, run, withAgentIdentity } from '../runner.js';

function format(result: RememberResult): string {
  const lines = [`remembered ${result.id} [${result.layer}] at ${result.created_at}`];
  if (result.supersedes) lines.push(`  supersedes ${result.supersedes} (predecessor expired)`);
  if (result.state_key) lines.push(`  state_key ${result.state_key} (previous holders closed)`);
  if (result.collision_candidates !== undefined) {
    if (result.collision_candidates.length === 0) lines.push('  collision scan complete: no candidates');
    else {
      lines.push(`  collision candidates (${result.collision_candidates.length}):`);
      for (const candidate of result.collision_candidates) {
        lines.push(`    ${candidate.id}  ${candidate.title}  priority ${candidate.pair_priority}`);
      }
    }
  }
  return lines.join('\n');
}

export function registerRemember(program: Command): void {
  program
    .command('remember <content...>')
    .description('Write a durable memory — a fact, procedure, or preference (ADR 0092.3 Phase C)')
    .requiredOption('--title <title>', 'Memory title (required, like a task title)')
    .option('--layer <layer>', 'episodic | semantic (default) | procedural')
    .option('--context <id>', 'Scope container (e.g. FLDR-0001)')
    // Comma-separated, not variadic (BUG-0004): a variadic option before
    // the variadic <content...> positional swallowed the content.
    .option('--tags <tags>', 'Comma-separated labels (e.g. exp-1,friction)')
    .option('--refs <ids>', 'Comma-separated source entity ids (e.g. TASK-0676,ADR-0027)')
    .option('--kind <kind>', 'current | historical | plan | preference | timeless')
    .option('--state-key <key>', 'Evolving-fact key — closes previous holders')
    .option('--occurred-at <iso>', 'When the event occurred (ISO date)')
    .option('--valid-until <iso>', 'Expiry (ISO date)')
    .option('--supersedes <id>', 'MEMO- id this memory replaces')
    .option('--derived', 'Mark as inference (consolidator output) — requires --refs')
    .option('--as <agent>', 'Attribute this memory to an agent identity — an AGENT- doc id or declared principal (e.g. aime:granite). Optional per-call override; usually implicit via git config backlog.agent or BACKLOG_AGENT (ADR 0119.1)')
    .action((contentParts: string[], opts) => run(
      async (runtime) => {
        // ADR 0105: explicit --context wins; else per-repo config / env default.
        const context = resolveContext({
          explicit: opts.context,
          ...(runtime.home === undefined ? {} : { home: runtime.home }),
        });
        const tags = parseCommaList(opts.tags);
        const refs = parseCommaList(opts.refs);
        const result = await remember(
        {
          content: contentParts.join(' '),
          title: opts.title,
          ...(opts.layer !== undefined ? { layer: opts.layer } : {}),
          ...(context !== undefined ? { context } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(refs !== undefined ? { entity_refs: refs } : {}),
          ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
          ...(opts.stateKey !== undefined ? { state_key: opts.stateKey } : {}),
          ...(opts.occurredAt !== undefined ? { occurred_at: opts.occurredAt } : {}),
          ...(opts.validUntil !== undefined ? { valid_until: opts.validUntil } : {}),
          ...(opts.supersedes !== undefined ? { supersedes: opts.supersedes } : {}),
          ...(opts.derived !== undefined ? { derived: opts.derived } : {}),
        },
        {
          memoryComposer: runtime.memoryComposer,
          actorName: runtime.writeContext.actor.name,
          // Intent journal (EXP-1 B-4) — same attribution style as the
          // other CLI writes ('backlog create' etc.).
          journal: { context: runtime.writeContext, tool: 'backlog remember' },
          findCollisionCandidates: function findCandidates(memoryId) {
            return findCollisionCandidatesForMemory(runtime.service, memoryId);
          },
        },
        );
        // Citation signal (ADR 0092.9 R-14): cited MEMO- ids were useful.
        if (runtime.usageTracker !== undefined) {
          await runtime.usageTracker.recordCitations(
            [contentParts.join(' ')],
            (refs ?? []).filter(
              function excludeCreatedMemory(ref) {
                return ref !== result.id;
              },
            ),
          );
        }
        return result;
      },
      format,
      program.opts().json,
      withAgentIdentity(cliRuntimeDependencies(program), opts.as),
    ));
}
