import type { Command } from 'commander';
import { getItems } from '../../core/get.js';
import type { ContextStub, ContextStubs } from '../../core/get-context/index.js';
import type { GetItem, GetResult } from '../../core/types.js';
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
  const groups: Array<[string, ContextStub[] | undefined]> = [
    ['children', context.children],
    ['siblings', context.siblings],
    ['references', context.references],
    ['referenced_by', context.referenced_by],
    ['related', context.related],
    ['ancestors', context.ancestors],
    ['descendants', context.descendants],
  ];
  for (const [role, stubs] of groups) {
    if (stubs?.length) sections.push(`${role} (${stubs.length}):\n${stubs.map(formatStub).join('\n')}`);
  }
  // Typed relations (ADR 0113.1 R-3) — declared frontmatter edges
  // (respects/violates/spawned/…), forward and computed-reverse.
  for (const [role, stubs] of Object.entries(context.relations ?? {})) {
    if (stubs.length) sections.push(`${role} (${stubs.length}):\n${stubs.map(formatStub).join('\n')}`);
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

/** Entity-id items only — resource-path and not-found gets are never expansions. */
function expandedEntityIds(items: GetItem[]): string[] {
  return items
    .filter(item => item.content !== null && item.resource === undefined)
    .map(item => item.id);
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
        });
        if (runtime.usageTracker !== undefined) {
          // Stub→expand strong usage signal (ADR 0092.9 R-14).
          for (const item of result.items) {
            if (item.id.startsWith('MEMO-') && item.content !== null) {
              await runtime.usageTracker.recordExpand(item.id);
            }
          }
          // Tier-1 expand telemetry — the neighborhood act (report 0010 F3).
          if (opts.context === true) {
            runtime.usageTracker.recordContextExpand(expandedEntityIds(result.items));
          }
        }
        return result;
      },
      format,
      program.opts().json,
      cliRuntimeDependencies(program),
    ));
}
