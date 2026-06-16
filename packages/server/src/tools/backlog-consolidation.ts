/**
 * backlog_consolidation_candidates — the server's half of memory
 * consolidation (ADR 0092.7 Phase D).
 *
 * Read-only and deterministic: clusters live, non-derived episodic memories
 * into candidate bundles. The judgment half — distilling a bundle into one
 * narrative semantic/procedural memory — belongs to an external consolidator
 * agent (ADR 0097: the store doesn't act). The consolidator contract is in
 * the tool description so every agent that lists tools sees the workflow.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { consolidationCandidates, type ConsolidationDeps } from '../core/consolidation.js';
import { ValidationError } from '../core/types.js';

export function registerBacklogConsolidationTool(
  server: McpServer,
  service: IBacklogService,
  deps?: ConsolidationDeps,
): void {
  server.registerTool(
    'backlog_consolidation_candidates',
    {
      description:
        'List clusters of episodic memories that are ripe for consolidation into durable knowledge. ' +
        'Consolidator workflow: (1) call this and take ripe bundles; (2) per bundle, read members (backlog_get on MEMO- ids for depth), ' +
        'then write ONE narrative memory via backlog_remember({ layer: "semantic"|"procedural", derived: true, entity_refs: [member MEMO- ids + key source entities], context }) — ' +
        'a self-contained story, not fragments; (3) retire the members via backlog_forget({ ids }) so they stop appearing here while staying auditable; ' +
        '(4) track your progress with a backlog_remember state_key like "consolidation.watermark.<scope>".',
      inputSchema: z.object({
        min_count: z.number().min(1).optional().describe('Minimum bundle size to be ripe. Default: 3.'),
        min_age_days: z.number().min(0).optional().describe('Minimum age (days) of the oldest member. Default: 7.'),
        min_demand: z.number().min(0).optional().describe('Recall-demand threshold — bundles recalled this often (30d) are ripe regardless of age. Default: 3.'),
        context: z.string().optional().describe('Restrict to one context (e.g. "FLDR-0001").'),
        limit: z.number().min(1).max(50).optional().describe('Max bundles, ripe first. Default: 10.'),
        max_digests: z.number().min(1).optional().describe('Max digest lines per bundle. Default: 10.'),
      }),
    },
    async (params) => {
      try {
        const result = await consolidationCandidates(service, {
          ...(params.min_count !== undefined ? { min_count: params.min_count } : {}),
          ...(params.min_age_days !== undefined ? { min_age_days: params.min_age_days } : {}),
          ...(params.min_demand !== undefined ? { min_demand: params.min_demand } : {}),
          ...(params.context !== undefined ? { context: params.context } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
          ...(params.max_digests !== undefined ? { max_digests: params.max_digests } : {}),
        }, deps ?? {});
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
