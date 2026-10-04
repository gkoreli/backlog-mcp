import type { Command } from 'commander';
import { getItems } from '../../core/get.js';
import { listContextGroups, type ContextStub, type ContextStubs } from '../../core/get-context/index.js';
import type { GetResult } from '../../core/types.js';
import { cliRuntimeDependencies, run } from '../runner.js';

function formatStub(stub: ContextStub): string {
  const parts = [stub.id, stub.type];
  if (stub.status) parts.push(stub.status);
  // Compliance reads red in place (ADR 0113.1 R-3) — a violated requirement
  // must be visible in the relation list itself, before any hydration.
  if (stub.compliance) parts.push(stub.compliance === 'violated' ? '⚠ violated' : stub.compliance);
  let line = `  - ${parts.join(' · ')} — ${stub.title}`;
  if (stub.graph_depth !== undefined) line += ` (depth ${stub.graph_depth})`;
  return line;
}

/** Render role-grouped relational stubs (ADR 0114) — hydrate any id with another get. */
function formatContext(context: ContextStubs): string {
  const sections: string[] = ['── context: relational stubs (hydrate with get) ──'];
  if (context.parent) sections.push(`parent:\n${formatStub(context.parent)}`);
  for (const [role, stubs] of listContextGroups(context)) {
    sections.push(`${role} (${stubs.length}):\n${stubs.map(formatStub).join('\n')}`);
  }
  return sections.join('\n\n');
}

function format(result: GetResult): string {
  return result.items.map(i => {
    if (!i.content) return `--- ${i.id} ---\n${i.error ?? '(no content)'}`;
    const body = `--- ${i.id} ---\n${i.content}`;
    return i.context ? `${body}\n\n${formatContext(i.context)}` : body;
  }).join('\n\n');
}

export function registerGet(program: Command): void {
  program
    .command('get <ids...>')
    .description('Get one or more items by ID')
    .option('--context', 'Expand each entity\'s relational neighborhood as stubs (ADR 0114) — parent/children/siblings/references/referenced_by/related; hydrate any stub with another get')
    .action((ids, opts) => run(
      async (runtime) => {
        const result = await getItems(runtime.service, {
          ids,
          ...(opts.context === true ? { context: true } : {}),
        }, runtime.usageTracker);
        return result;
      },
      format,
      program.opts().json,
      cliRuntimeDependencies(program),
    ));
}
