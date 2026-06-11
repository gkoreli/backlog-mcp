import type { Command } from 'commander';
import { consolidationCandidates } from '../../core/consolidation.js';
import type { ConsolidationCandidatesResult } from '../../core/types.js';
import { run } from '../runner.js';

function format(result: ConsolidationCandidatesResult): string {
  if (result.bundles.length === 0) {
    return `No consolidation candidates (${result.total_episodic} live episodic memories, none bucketed).`;
  }
  const lines: string[] = [
    `── consolidation candidates (${result.ripe_count} ripe / ${result.bundles.length} shown / ${result.total_episodic} episodic) ──`,
    '',
  ];
  for (const b of result.bundles) {
    lines.push(`  ${b.ripe ? '🟢 ripe ' : '⚪ young'}  ${b.key}  (${b.count} members, ${b.oldest_created_at.slice(0, 10)} → ${b.newest_created_at.slice(0, 10)})`);
    for (let i = 0; i < b.digests.length; i++) {
      lines.push(`           ${b.member_ids[i] ?? '?'}  ${b.digests[i]}`);
    }
    if (b.entity_refs.length > 0) lines.push(`           refs: ${b.entity_refs.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function registerConsolidation(program: Command): void {
  program
    .command('consolidation-candidates')
    .description('Clusters of episodic memories ripe for distillation into knowledge (ADR 0092.7)')
    .option('--min-count <n>', 'Minimum bundle size to be ripe (default 3)', parseInt)
    .option('--min-age-days <n>', 'Minimum age of the oldest member (default 7)', parseInt)
    .option('--context <id>', 'Restrict to one context (e.g. FLDR-0001)')
    .option('--limit <n>', 'Max bundles (default 10)', parseInt)
    .action((opts) => run(
      (s) => consolidationCandidates(s, {
        ...(opts.minCount !== undefined ? { min_count: opts.minCount } : {}),
        ...(opts.minAgeDays !== undefined ? { min_age_days: opts.minAgeDays } : {}),
        ...(opts.context !== undefined ? { context: opts.context } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      }),
      format,
      program.opts().json,
    ));
}
