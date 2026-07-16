/**
 * backlog_forget — the memory retraction verb (ADR 0092.3 Phase C).
 *
 * Soft by default (ADR 0092.5 R-12): forgotten memories are expired
 * (`valid_until = now`) — dropped from recall, still auditable in the
 * viewer. `expired: true` is the GC path: hard-deletes already-expired
 * memories. Hard deletion of live memories stays a human action.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryComposer } from '@backlog-mcp/memory';
import { z } from 'zod';
import { forget } from '../core/forget.js';
import { ValidationError } from '../core/types.js';
import { BACKLOG_HOME_INPUT_FIELDS } from './home-input.js';

export interface BacklogForgetDeps {
  memoryComposer?: MemoryComposer;
}

export function registerBacklogForgetTool(
  server: McpServer,
  deps?: BacklogForgetDeps,
): void {
  server.registerTool(
    'backlog_forget',
    {
      description:
        'Retract memories — soft-expire them so recall stops returning them (the record stays auditable in the viewer). Use when knowledge is wrong or obsolete and there is no replacement (if there IS a replacement, use backlog_remember with supersedes instead). expired:true garbage-collects already-expired memories.',
      inputSchema: z.object({
        ...BACKLOG_HOME_INPUT_FIELDS,
        ids: z.array(z.string()).optional().describe('Specific MEMO- ids to forget.'),
        context: z.string().optional().describe('Forget all memories scoped to this context (e.g. "FLDR-0001").'),
        layer: z.enum(['episodic', 'semantic', 'procedural']).optional().describe('Forget all memories in a layer.'),
        older_than: z.string().optional().describe('Forget memories created before this ISO date/datetime.'),
        expired: z.boolean().optional().describe('GC mode: hard-delete memories that are already expired.'),
      }),
    },
    async (params) => {
      try {
        const result = await forget(
          {
            ...(params.ids !== undefined ? { ids: params.ids } : {}),
            ...(params.context !== undefined ? { context: params.context } : {}),
            ...(params.layer !== undefined ? { layer: params.layer } : {}),
            ...(params.older_than !== undefined ? { older_than: params.older_than } : {}),
            ...(params.expired !== undefined ? { expired: params.expired } : {}),
          },
          { ...(deps?.memoryComposer ? { memoryComposer: deps.memoryComposer } : {}) },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        if (e instanceof ValidationError) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true };
        }
        throw e;
      }
    },
  );
}
