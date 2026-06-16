import type { Command } from 'commander';
import { detectContradictions } from '../../core/contradictions.js';
import type { ContradictionsResult } from '../../core/types.js';
import { run } from '../runner.js';

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

export function registerContradictions(program: Command): void {
  program
    .command('contradictions')
    .description('Live memories that share a state_key — the R-2 invariant breached, flagged for human adjudication (ADR 0092.13)')
    .action(() => run(
      (s) => detectContradictions(s),
      format,
      program.opts().json,
    ));
}
