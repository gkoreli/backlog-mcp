/**
 * backlog_recall — query the episodic memory corpus (ADR 0092.2 Phase 3b).
 *
 * Thin MCP wrapper around `core/recall`. Distinct from `backlog_search`:
 * search queries the live backlog (tasks, epics, resources). Recall queries
 * memory — the pointer + digest records written when tasks complete or
 * artifacts are created.
 *
 * Why both:
 *   - `backlog_search` is breadth-first: all entities, current content.
 *   - `backlog_recall` is curated: just the events you wanted to remember.
 *
 * If no memory composer is wired (Worker build today), the tool responds
 * with an empty result set rather than erroring — "no memory" is valid.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryComposer } from '@backlog-mcp/memory';
import { z } from 'zod';
import { recall } from '../core/recall.js';
import { ValidationError } from '../core/types.js';

export interface BacklogRecallDeps {
  memoryComposer?: MemoryComposer;
}

export function registerBacklogRecallTool(
  server: McpServer,
  deps?: BacklogRecallDeps,
): void {
  server.registerTool(
    'backlog_recall',
    {
      description:
        'Recall episodic memories — short digest records captured when tasks complete or artifacts are created. Distinct from backlog_search (which queries live entities). Use this to answer "what did I finish recently about X?" or "what artifacts live under FLDR-0001?" — the memories point back to entities via metadata.entity_id.',
      inputSchema: z.object({
        query: z.string().describe('Free-text query (keyword or phrase).'),
        context: z.string().optional().describe(
          'Optional scope — usually a parent_id like "FLDR-0001". Filters to memories captured with that entity as their context.',
        ),
        tags: z.array(z.string()).optional().describe(
          'Filter by memory tags (any-match). e.g. ["artifact"] or ["task"].',
        ),
        layers: z.array(z.enum(['session', 'episodic', 'semantic', 'procedural'])).optional().describe(
          'Restrict to specific memory layers. Default: ["episodic"] (only Phase 3 capture kind today).',
        ),
        limit: z.number().min(1).max(50).optional().describe('Max results. Default: 10.'),
      }),
    },
    async (params) => {
      try {
        const result = await recall(
          {
            query: params.query,
            ...(params.context !== undefined ? { context: params.context } : {}),
            ...(params.tags !== undefined ? { tags: params.tags } : {}),
            ...(params.layers !== undefined ? { layers: params.layers } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
          },
          { ...(deps?.memoryComposer ? { memoryComposer: deps.memoryComposer } : {}) },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        if (e instanceof ValidationError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }],
            isError: true,
          };
        }
        throw e;
      }
    },
  );
}
