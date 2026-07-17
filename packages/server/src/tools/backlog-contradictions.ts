/**
 * backlog_contradictions — R-9 contradiction detection (ADR 0092.13).
 *
 * Read-only and deterministic: surfaces LIVE memories that share a state_key,
 * i.e. the one-live-holder-per-key invariant (ADR 0092.5 R-2) breached. The
 * agent can call this mid-task to catch its own conflicting beliefs and then
 * RESOLVE through the existing verbs — never automatically (R-9). The
 * resolution contract lives in the tool description so every agent sees it.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { detectContradictions } from '../core/contradictions.js';
import { findCollisionCandidatePairs } from '../core/collision-candidates.js';
import { BACKLOG_HOME_INPUT_FIELDS } from './home-input.js';

export function registerBacklogContradictionsTool(
  server: McpServer,
  service: IBacklogService,
): void {
  server.registerTool(
    'backlog_contradictions',
    {
      description:
        'List structural contradictions in memory: sets of ≥2 LIVE memories that share one state_key (e.g. "db.primary"), ' +
        'which should never happen — a new memory with a state_key auto-expires the previous holder. Each set means two ' +
        'beliefs about the same fact are both active. Resolution is yours, never automatic: pick the correct member, then ' +
        'either backlog_remember({ content, state_key, supersedes: <stale MEMO- id> }) to record the right value and retire ' +
        'the rest, or backlog_forget({ ids: [<stale MEMO- ids>] }) to expire the wrong ones. Read members with backlog_get ' +
        'for full context before deciding. Set candidates: true to list semantic collision candidates instead: nearby live facts that deserve review, never contradiction verdicts.',
      inputSchema: z.object({
        ...BACKLOG_HOME_INPUT_FIELDS,
        candidates: z.boolean().optional().describe('Return semantic collision candidates instead of structural state_key contradictions.'),
      }),
    },
    async (params) => {
      const result = params.candidates === true
        ? await findCollisionCandidatePairs(service)
        : await detectContradictions(service);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
