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
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';

export interface BacklogRecallDeps {
  memoryComposer?: MemoryComposer;
  /** Logs recall demand to the usage JSONL (ADR 0092.9 R-16). */
  usageTracker?: MemoryUsageTracker;
}

export function registerBacklogRecallTool(
  server: McpServer,
  deps?: BacklogRecallDeps,
): void {
  server.registerTool(
    'backlog_recall',
    {
      description:
        'Recall memories — knowledge and episodes captured across sessions. Returns STUBS (title + one-line digest + provenance) by default; expand interesting ones with backlog_get(MEMO-id), or pass full:true for bodies. Weigh a stub\'s trust BEFORE hydrating: age_days (on the knowledge\'s own timeline), uses/idle_days (recall demand), supersedes (this is a correction), derived (consolidator inference), kind (current/historical/plan/preference/timeless). Old + never-used = treat as hypothesis, not truth. Distinct from backlog_search (live entities). Use to answer "how do we deploy?", "have I hit this before?", "what did I finish about X?". Memories point back to source entities via entity_id.',
      inputSchema: z.object({
        query: z.string().describe('Free-text query (keyword or phrase).'),
        context: z.string().optional().describe(
          'Optional scope — usually a parent_id like "FLDR-0001". Filters to memories captured with that entity as their context.',
        ),
        tags: z.array(z.string()).optional().describe(
          'Filter by memory tags (any-match). e.g. ["artifact"] or ["task"].',
        ),
        layers: z.array(z.enum(['session', 'episodic', 'semantic', 'procedural'])).optional().describe(
          'Restrict to specific memory layers. Default: all persisted layers (episodic + semantic + procedural).',
        ),
        limit: z.number().min(1).max(50).optional().describe('Max results. Default: 10.'),
        full: z.boolean().optional().describe('Return full memory bodies instead of stubs. Prefer stubs + backlog_get for the ones you need.'),
        token_budget: z.number().min(50).optional().describe('Approximate token budget — results are greedily packed to fit.'),
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
            ...(params.full !== undefined ? { full: params.full } : {}),
            ...(params.token_budget !== undefined ? { token_budget: params.token_budget } : {}),
          },
          { ...(deps?.memoryComposer ? { memoryComposer: deps.memoryComposer } : {}) },
        );
        // Recall demand log (R-16) — weak signal, JSONL only; recall stays
        // a pure read of the memory entities themselves.
        deps?.usageTracker?.recordRecall(params.query, result.items.map(i => i.id));
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
