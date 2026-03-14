import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { ENTITY_TYPES, STATUSES, getQuadrant, getPriorityScore, type Quadrant } from '@backlog-mcp/shared';

export function registerBacklogListTool(server: McpServer, service: IBacklogService) {
  server.registerTool(
    'backlog_list',
    {
      description: 'List tasks from backlog. Returns most recently updated items first. Default: shows only active work (open/in_progress/blocked), limited to 20 items. Use counts=true to check if more items exist beyond the limit.',
      inputSchema: z.object({
        status: z.array(z.enum(STATUSES)).optional().describe('Filter by status. Options: open, in_progress, blocked, done, cancelled. Default: [open, in_progress, blocked]. Pass ["done"] to see completed work.'),
        type: z.enum(ENTITY_TYPES).optional().describe('Filter by type. Options: task, epic, folder, artifact, milestone. Default: returns all.'),
        epic_id: z.string().optional().describe('Filter tasks belonging to a specific epic. Example: epic_id="EPIC-0001"'),
        parent_id: z.string().optional().describe('Filter items by parent. Example: parent_id="FLDR-0001"'),
        query: z.string().optional().describe('Search across all task fields (title, description, evidence, references, etc.). Case-insensitive substring matching.'),
        counts: z.boolean().optional().describe('Include global counts { total_tasks, total_epics, by_status, by_type } alongside results. Use this to detect if more items exist beyond the limit. Default: false'),
        limit: z.number().optional().describe('Max items to return. Default: 20. Increase if you need to see more items (e.g., limit=100 to list all epics).'),
        quadrant: z.enum(['q1', 'q2', 'q3', 'q4']).optional().describe('Filter by Eisenhower quadrant: q1=Do now (urgent+important), q2=Schedule (important, not urgent), q3=Quick-handle (urgent, not important), q4=Park (neither). Only returns tasks with urgency and/or importance set.'),
        sort: z.enum(['recent', 'priority']).optional().describe('Sort order: recent=by updated_at desc (default), priority=by urgency+importance score desc (highest first).'),
      }),
    },
    async ({ status, type, epic_id, parent_id, query, counts, limit, quadrant, sort }) => {
      // parent_id takes precedence; epic_id is alias for backward compat
      const resolvedParent = parent_id ?? epic_id;
      let tasks = await service.list({ status, type, parent_id: resolvedParent, query, limit });

      // Quadrant filter (ADR-0084): in-memory since storage has no quadrant column
      if (quadrant) {
        tasks = tasks.filter(t =>
          (t.urgency !== undefined || t.importance !== undefined) &&
          getQuadrant(t.urgency, t.importance) === (quadrant as Quadrant)
        );
      }

      // Priority sort (ADR-0084): reorder by urgency+importance score
      if (sort === 'priority') {
        tasks = [...tasks].sort((a, b) =>
          getPriorityScore(b.urgency, b.importance) - getPriorityScore(a.urgency, a.importance)
        );
      }

      const list = tasks.map((t) => {
        const item: Record<string, unknown> = {
          id: t.id,
          title: t.title,
          status: t.status,
          type: t.type ?? 'task',
          parent_id: t.parent_id ?? t.epic_id,
        };
        if (t.urgency !== undefined) item.urgency = t.urgency;
        if (t.importance !== undefined) item.importance = t.importance;
        if (t.urgency !== undefined || t.importance !== undefined) {
          item.quadrant = getQuadrant(t.urgency, t.importance);
        }
        return item;
      });
      const result: any = { tasks: list };
      if (counts) result.counts = await service.counts();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
