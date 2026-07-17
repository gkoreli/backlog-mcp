import type { Command } from 'commander';
import { wakeup } from '../../core/wakeup.js';
import { enforceWakeupCeiling } from '../../core/wakeup-wire.js';
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

/** The memory protocol prints last — the twin rubric closes the briefing. */
function memoryProtocolSection(
  protocol: WakeupResult['memory_protocol'],
): string[] {
  return [
    '',
    '── memory protocol ──',
    `  recall: ${protocol.recall}`,
    `  remember: ${protocol.remember}`,
  ];
}

function format(result: WakeupResult | Omit<WakeupResult, 'memory_protocol'>): string {
  const lines: string[] = [];

  if (result.identity) {
    lines.push('── identity ──', result.identity);
  }
  if (result.scope) {
    lines.push('', `scope: ${result.scope}`);
  }

  // The focal operation leads (north-star Amnesia contract): an amnesiac
  // reads its own operation before anything else. Fields beyond id/title
  // are whatever the substrate's declaration projected — printed as-is.
  if (result.focus) {
    lines.push(
      '',
      `── FOCUS: ${result.focus.doc.id} (${result.focus.section}) ──`,
      `  ${result.focus.doc.title}`,
      ...Object.entries(result.focus.doc)
        .filter(([key]) => key !== 'id' && key !== 'title')
        .map(([key, value]) =>
          `  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`),
    );
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
      ...((result.metadata.constraints_omitted ?? 0) > 0
        ? [`  … ${result.metadata.constraints_omitted} more live constraint(s) omitted — raise --max-constraints`]
        : []),
    ]),
    ...Object.entries(result.sections).flatMap(([name, stubs]) =>
      section(name, [
        ...stubs.map(st =>
          `  ${String(st.id).padEnd(12)} ${st.status !== undefined ? `[${st.status}] ` : ''}${st.title}`),
        ...((result.metadata.sections_omitted?.[name] ?? 0) > 0
          ? [`  … ${result.metadata.sections_omitted?.[name]} more omitted`]
          : []),
      ]),
    ),
    // A quarantined claim means a typed section above is NOT complete —
    // the downgrade must be as visible as the sections it hollows (B-3).
    ...section('quarantined (claimed but could not compile)',
      (result.metadata.quarantined ?? []).map(q =>
        `  ${q.type.padEnd(12)} ${q.path} — still readable via search/get`,
      )),
    ...section('vision', result.vision
      ? [`  ${result.vision.title} — ${result.vision.path} (hydrate on demand)`]
      : (result.metadata.vision_candidates ?? []).length > 0
        ? [`  ambiguous — multiple vision candidates: ${(result.metadata.vision_candidates ?? []).join(', ')}`]
        : []),
    ...section('orientation (paths open with get)', [
      ...(result.orientation?.docs ?? []).map(d =>
        `  ${d.role.padEnd(7)} ${d.path} — ${d.title}`),
      ...(result.orientation?.note !== undefined
        ? [`  ${result.orientation.note}`]
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
    // LATTICE W1: a linked-worktree home names its family and divergence.
    ...(result.metadata.worktree !== undefined
      ? [`  worktree: ${result.metadata.worktree}`]
      : []),
    `  identity: ${result.identity !== undefined ? 'present' : 'absent'}`,
    `  counts: active=${result.now.active_tasks.length} epics=${result.now.current_epics.length} knowledge=${result.knowledge.length} constraints=${result.constraints.length}${(result.metadata.constraints_omitted ?? 0) > 0 ? `(+${result.metadata.constraints_omitted} omitted)` : ''} completions=${result.recent.completions.length} activity=${result.recent.activity.length} unfiled=${result.metadata.unfiled_count ?? 0}`,
    // The honest ceiling marker (ADR 0118.1 Slice A) — never silent.
    ...(result.metadata.truncated !== undefined
      ? [`  truncated by wire ceiling: ${Object.entries(result.metadata.truncated).map(([surface, count]) => `${surface}=${count}`).join(' ')}`]
      : []),
  );

  // Single-home briefings close on the protocol (flywheel F1 placement);
  // cross-home groups omit it here — it prints once for the whole payload.
  if ('memory_protocol' in result) {
    lines.push(...memoryProtocolSection(result.memory_protocol));
  }

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
  sections.push(memoryProtocolSection(result.memory_protocol).join('\n').trimStart());
  return sections.join('\n\n');
}

export function registerWakeup(program: Command): void {
  program
    .command('wakeup')
    .description('Session-start briefing (active tasks, epics, recent completions, activity)')
    .option('--scope <id>', 'Scope to a container entity (folder/milestone/epic)')
    .option('--operation <id>', 'Focus the briefing on one live operation document (its declared projection becomes the centerpiece; non-focal sections yield budget)')
    .option('--max-completions <n>', 'Max recent completions', parseInt)
    .option('--max-activity <n>', 'Max recent activity entries', parseInt)
    .option('--max-knowledge <n>', 'Max knowledge items (semantic/procedural memories)', parseInt)
    .option('--max-constraints <n>', 'Max requirement constraint stubs (0 disables)', parseInt)
    .option('--evidence-chars <n>', 'Max chars of evidence per completion', parseInt)
    .action((opts) => {
      const deps = cliRuntimeDependencies(program);
      const baseParams: WakeupParams = {
        ...(opts.operation !== undefined ? { operation: opts.operation } : {}),
        ...(opts.maxCompletions !== undefined ? { maxCompletions: opts.maxCompletions } : {}),
        ...(opts.maxActivity !== undefined ? { maxActivity: opts.maxActivity } : {}),
        ...(opts.maxKnowledge !== undefined ? { maxKnowledge: opts.maxKnowledge } : {}),
        ...(opts.maxConstraints !== undefined ? { maxConstraints: opts.maxConstraints } : {}),
        ...(opts.evidenceChars !== undefined ? { evidenceSnippetChars: opts.evidenceChars } : {}),
      };
      if (deps.home === 'all') {
        const scope = resolveContext({ explicit: opts.scope });
        return runAcrossHomes(
            (coordinator, selection) => coordinator.wakeup(
              {
                ...baseParams,
                ...(scope === undefined ? {} : { scope }),
              },
              selection,
            ),
            formatAcrossHomes,
            program.opts().json,
            deps,
          );
      }
      return run(
            async (runtime) => {
              const scope = resolveContext({
                explicit: opts.scope,
                ...(runtime.home === undefined ? {} : { home: runtime.home }),
              });
              // The CLI is the SessionStart recipe's transport (ADR 0118.1
              // R3): it obeys the same hard ceiling as the MCP boundary.
              return enforceWakeupCeiling(await wakeup(runtime.service, {
              ...baseParams,
              ...(scope === undefined ? {} : { scope }),
              readIdentity: runtime.readIdentity,
              acceptsParent: function acceptsParent(type) {
                return runtime.writeContext.substrateRegistry?.acceptsParent(type) === true;
              },
              ...(runtime.readVision === undefined ? {} : { readVision: runtime.readVision }),
              ...(runtime.readGrounding === undefined ? {} : { readGrounding: runtime.readGrounding }),
              readOperations: (options) => runtime.operationLogger.read(options),
              ...(runtime.mintMemoryEntry === undefined
                ? {}
                : { mintMemoryEntry: runtime.mintMemoryEntry }),
              }));
            },
            format,
            program.opts().json,
            deps,
          );
    });
}
