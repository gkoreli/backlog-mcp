import type { Command } from 'commander';
import { detectContradictions } from '../../core/contradictions.js';
import { findCollisionCandidatePairs } from '../../core/collision-candidates.js';
import type { CollisionCandidatesResult, ContradictionsResult } from '../../core/types.js';
import { cliRuntimeDependencies, run } from '../runner.js';

function format(result: ContradictionsResult): string {
  if (result.groups.length === 0) {
    return `No contradictions (${result.total_live_keyed} live keyed memories, one holder per key).`;
  }
  const lines: string[] = [
    `── contradictions (${result.contradiction_count} conflicted keys / ${result.total_live_keyed} live keyed) ──`,
    '',
  ];
  for (const g of result.groups) {
    lines.push(`  ⚠ ${g.state_key}  (${g.count} live holders)`);
    for (const m of g.members) {
      const refs = m.entity_refs.length > 0 ? `  refs: ${m.entity_refs.join(', ')}` : '';
      lines.push(`       ${m.id}  ${m.created_at.slice(0, 10)}  ${m.title}${refs}`);
    }
    lines.push('       → resolve: backlog_remember({ state_key, supersedes }) or backlog_forget({ ids })');
    lines.push('');
  }
  return lines.join('\n');
}

function formatCandidates(result: CollisionCandidatesResult): string {
  if (result.pairs.length === 0) {
    return `No collision candidates (${result.total_live_memories} live memories scanned).`;
  }
  const lines = [`── collision candidates (${result.candidate_count} / ${result.total_live_memories} live memories) ──`, ''];
  for (const pair of result.pairs) {
    const [first, second] = pair.members;
    if (first === undefined || second === undefined) continue;
    lines.push(`  ${pair.pair_priority}  ${first.id}  ${first.title}`);
    lines.push(`                    ${second.id}  ${second.title}`);
  }
  return lines.join('\n');
}

function formatResult(result: ContradictionsResult | CollisionCandidatesResult): string {
  return 'pairs' in result ? formatCandidates(result) : format(result);
}

export function registerContradictions(program: Command): void {
  program
    .command('contradictions')
    .description('Live memories that share a state_key — the R-2 invariant breached, flagged for human adjudication (ADR 0092.13)')
    .option('--candidates', 'List semantic collision candidates instead of structural state_key contradictions')
    .action((opts) => run(
      (runtime) => opts.candidates === true
        ? findCollisionCandidatePairs(runtime.service)
        : detectContradictions(runtime.service),
      formatResult,
      program.opts().json,
      cliRuntimeDependencies(program),
    ));
}
