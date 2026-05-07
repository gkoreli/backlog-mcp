import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { wakeup } from '../../core/wakeup.js';
import type { WakeupResult } from '../../core/types.js';
import { operationLogger } from '../../operations/logger.js';
import { paths } from '../../utils/paths.js';
import { run } from '../runner.js';

const IDENTITY_FILENAME = 'identity.md';

function readIdentityFile(): string | undefined {
  const path = join(paths.backlogDataDir, IDENTITY_FILENAME);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, 'utf-8').trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

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
    `  counts: active=${result.metadata.active_task_count} epics=${result.metadata.epic_count} completions=${result.metadata.completion_count} activity=${result.metadata.activity_count}`,
  );

  return lines.join('\n');
}

export function registerWakeup(program: Command): void {
  program
    .command('wakeup')
    .description('Session-start briefing (active tasks, epics, recent completions, activity)')
    .option('--scope <id>', 'Scope to a container entity (folder/milestone/epic)')
    .option('--max-completions <n>', 'Max recent completions', parseInt)
    .option('--max-activity <n>', 'Max recent activity entries', parseInt)
    .option('--evidence-chars <n>', 'Max chars of evidence per completion', parseInt)
    .action((opts) => run(
      (s) => wakeup(s, {
        ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
        ...(opts.maxCompletions !== undefined ? { maxCompletions: opts.maxCompletions } : {}),
        ...(opts.maxActivity !== undefined ? { maxActivity: opts.maxActivity } : {}),
        ...(opts.evidenceChars !== undefined ? { evidenceSnippetChars: opts.evidenceChars } : {}),
        readIdentity: readIdentityFile,
        readOperations: (o) => operationLogger.read(o),
      }),
      format,
      program.opts().json,
    ));
}
