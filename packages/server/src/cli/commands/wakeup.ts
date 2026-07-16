import type { Command } from 'commander';
import { wakeup } from '../../core/wakeup.js';
import { resolveContext } from '../../core/config.js';
import type { WakeupParams, WakeupResult } from '../../core/types.js';
import type { CrossHomeWakeupResult } from '../../core/home-read-coordinator.types.js';
import {
  cliRuntimeDependencies,
  run,
  runAcrossHomes,
} from '../runner.js';

function section(title: string, body: string[]): string[] {
  if (body.length === 0) return [];
  return ['', `── ${title} ──`, ...body];
}

function format(result: WakeupResult): string {
  const lines: string[] = [];

  if (result.identity) {
    lines.push('── identity ──', result.identity);
  }
  if (result.scope) {
    lines.push('', `scope: ${result.scope}`);
  }

  lines.push(
    ...section('now: active tasks', result.now.active_tasks.map(t =>
      `  ${t.id.padEnd(12)} ${(t.status ?? '-').padEnd(12)} ${t.title}`,
    )),
    ...section('now: current epics', result.now.current_epics.map(e =>
      `  ${e.id.padEnd(12)} ${(e.status ?? '-').padEnd(12)} ${e.title}`,
    )),
    ...section('knowledge', result.knowledge.map(k =>
      // Provenance inline (ADR 0115 R-4): age + usage let a human weigh a
      // knowledge line's authority at a glance, same grammar as recall stubs.
      `  ${k.id.padEnd(12)} [${k.layer}]${k.kind ? ` (${k.kind})` : ''} ${k.title}` +
      ` · ${k.age_days}d${k.uses > 0 ? ` · used ${k.uses}×` : ' · never used'}${k.source_ref ? ` ← ${k.source_ref}` : ''}`,
    )),
    ...section('constraints', [
      ...result.constraints.map(c => {
        // Worst-first authority line (ADR 0113.1 R-2): compliance leads,
        // assessment staleness qualifies it, violations name the offenders.
        const checked = c.checked_days_ago !== undefined ? `checked ${c.checked_days_ago}d ago` : 'never assessed';
        const violations = c.violations ? ` ⚠ violated by ${c.violations.ids.join(', ')}${c.violations.count > c.violations.ids.length ? ` +${c.violations.count - c.violations.ids.length}` : ''}` : '';
        return `  ${c.id.padEnd(12)} [${c.compliance}] (${c.status} · ${checked}) ${c.title}${violations}`;
      }),
      ...(result.metadata.constraints_omitted > 0
        ? [`  … ${result.metadata.constraints_omitted} more live constraint(s) omitted — raise --max-constraints`]
        : []),
    ]),
    ...section('recent completions', result.recent.completions.map(c =>
      c.evidence_snippet
        ? `  ${c.id.padEnd(12)} ${c.title}\n      ↪ ${c.evidence_snippet}`
        : `  ${c.id.padEnd(12)} ${c.title}`,
    )),
    ...section('recent activity', result.recent.activity.map(a =>
      `  ${a.ts}  ${a.tool.padEnd(18)} ${a.entity_id ? a.entity_id.padEnd(12) : '-           '} by ${a.actor}`,
    )),
  );

  lines.push(
    '',
    `── meta ──`,
    `  generated_at: ${result.metadata.generated_at}`,
    `  identity: ${result.metadata.identity_present ? 'present' : 'absent'}`,
    `  counts: active=${result.metadata.active_task_count} epics=${result.metadata.epic_count} knowledge=${result.metadata.knowledge_count} constraints=${result.constraints.length}${result.metadata.constraints_omitted > 0 ? `(+${result.metadata.constraints_omitted} omitted)` : ''} completions=${result.metadata.completion_count} activity=${result.metadata.activity_count}`,
  );

  return lines.join('\n');
}

function formatAcrossHomes(result: CrossHomeWakeupResult): string {
  const sections = result.groups.map(function formatHome(group) {
    return [
      `══ home: ${group.home_id} ══`,
      format(group.briefing),
    ].join('\n');
  });
  for (const home of result.homes) {
    if (!home.available) {
      sections.push(`══ unavailable: ${home.home_id} ══\n${home.reason}`);
    }
  }
  return sections.join('\n\n');
}

export function registerWakeup(program: Command): void {
  program
    .command('wakeup')
    .description('Session-start briefing (active tasks, epics, recent completions, activity)')
    .option('--scope <id>', 'Scope to a container entity (folder/milestone/epic)')
    .option('--max-completions <n>', 'Max recent completions', parseInt)
    .option('--max-activity <n>', 'Max recent activity entries', parseInt)
    .option('--max-knowledge <n>', 'Max knowledge items (semantic/procedural memories)', parseInt)
    .option('--max-constraints <n>', 'Max requirement constraint stubs (0 disables)', parseInt)
    .option('--evidence-chars <n>', 'Max chars of evidence per completion', parseInt)
    .action((opts) => {
      const deps = cliRuntimeDependencies(program);
      // ADR 0105: flag wins; else fall back to per-repo config / env default.
      const scope = resolveContext({ explicit: opts.scope });
      const params: WakeupParams = {
        ...(scope !== undefined ? { scope } : {}),
        ...(opts.maxCompletions !== undefined ? { maxCompletions: opts.maxCompletions } : {}),
        ...(opts.maxActivity !== undefined ? { maxActivity: opts.maxActivity } : {}),
        ...(opts.maxKnowledge !== undefined ? { maxKnowledge: opts.maxKnowledge } : {}),
        ...(opts.maxConstraints !== undefined ? { maxConstraints: opts.maxConstraints } : {}),
        ...(opts.evidenceChars !== undefined ? { evidenceSnippetChars: opts.evidenceChars } : {}),
      };
      return deps.home === 'all'
        ? runAcrossHomes(
            (coordinator, selection) => coordinator.wakeup(
              params,
              selection,
            ),
            formatAcrossHomes,
            program.opts().json,
            deps,
          )
        : run(
            (runtime) => wakeup(runtime.service, {
              ...params,
              readIdentity: runtime.readIdentity,
              readOperations: (options) => runtime.operationLogger.read(options),
              ...(runtime.mintMemoryEntry === undefined
                ? {}
                : { mintMemoryEntry: runtime.mintMemoryEntry }),
            }),
            format,
            program.opts().json,
            deps,
          );
    });
}
