import { listContextGroups } from '../core/get-context/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../core/backlog-service.contract.js';
import { getItems, type GetItem, type ContextStub, type ContextStubs } from '../core/index.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import { BACKLOG_HOME_INPUT_FIELDS } from './home-input.js';

export interface BacklogGetDeps {
  /** Records MEMO- expands as strong usage events (ADR 0092.9 R-14). */
  usageTracker?: MemoryUsageTracker;
}

function formatStub(stub: ContextStub): string {
  const parts = [stub.id, stub.type];
  if (stub.status) parts.push(stub.status);
  // Compliance reads red in place (ADR 0113.1 R-3) — a violated requirement
  // must be visible in the relation list itself, before any hydration.
  if (stub.compliance) parts.push(stub.compliance === 'violated' ? '⚠ violated' : stub.compliance);
  let line = `- ${parts.join(' · ')} — ${stub.title}`;
  if (stub.graph_depth !== undefined) line += ` (depth ${stub.graph_depth})`;
  return line;
}

/** Render role-grouped relational stubs (ADR 0114) — hydrate any id with another backlog_get. */
function formatContext(context: ContextStubs): string {
  const sections: string[] = ['## Context — relational stubs (hydrate with backlog_get)'];
  if (context.parent) sections.push(`parent:\n${formatStub(context.parent)}`);
  for (const [role, stubs] of listContextGroups(context)) {
    sections.push(`${role} (${stubs.length}):\n${stubs.map(formatStub).join('\n')}`);
  }
  return sections.join('\n\n');
}

/** MCP transport formatting — core returns raw data, we present it */
function formatItem(item: GetItem): string {
  if (item.content === null) return item.error ?? `Not found: ${item.id}`;
  if (item.resource) {
    const header = `# Resource: ${item.id}\nMIME: ${item.resource.mimeType}`;
    const fm = item.resource.frontmatter ? `\nFrontmatter: ${JSON.stringify(item.resource.frontmatter)}` : '';
    return `${header}${fm}\n\n${item.resource.content}`;
  }
  if (item.context) return `${item.content}\n\n${formatContext(item.context)}`;
  return item.content;
}

export function registerBacklogGetTool(server: McpServer, service: IBacklogService, deps?: BacklogGetDeps): void {
  server.registerTool(
    'backlog_get',
    {
      description: 'Get full details by ID. Accepts task IDs (TASK-0001, EPIC-0002), document paths (README.md, docs/adr/0001-example.md), or MCP resource URIs (mcp://backlog/resources/design.md). Works for any item regardless of status. Pass context:true when starting work on an entity to also see its relational neighborhood as stubs.',
      inputSchema: z.object({
        ...BACKLOG_HOME_INPUT_FIELDS,
        id: z.union([z.string(), z.array(z.string())]).describe('Task ID (e.g. TASK-0001), document path (e.g. README.md, docs/notes/file.md), or MCP resource URI (e.g. mcp://backlog/resources/file.md). Array for batch fetch.'),
        context: z.boolean().optional().describe('Expand the entity\'s relational neighborhood as stubs — parent/children/siblings/references/referenced_by/related; hydrate any stub with another backlog_get.'),
        depth: z.number().int().min(1).max(2).optional().describe('Relational expansion depth with context:true. 1 = direct relations (default), 2 = grandparents/grandchildren.'),
      }),
    },
    async ({ id, context, depth }) => {
      const ids = Array.isArray(id) ? id : [id];
      if (ids.length === 0) {
        return { content: [{ type: 'text', text: 'Required: id' }], isError: true };
      }
      const result = await getItems(service, {
        ids,
        ...(context !== undefined ? { context } : {}),
        ...(depth !== undefined ? { depth } : {}),
      }, deps?.usageTracker);
      const text = result.items.map(formatItem).join('\n\n---\n\n');
      return { content: [{ type: 'text', text }] };
    }
  );
}
