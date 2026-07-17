/**
 * backlog_remember — the explicit memory write verb (ADR 0092.3 Phase C).
 *
 * Implicit capture already memorializes completions and artifacts; this tool
 * is how *distilled knowledge* enters memory: stable facts, procedures,
 * preferences. ADD-only (ADR 0092.5 R-1): corrections go through
 * `supersedes` or `state_key`, never body rewrites.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryComposer } from '@backlog-mcp/memory';
import { z } from 'zod';
import { remember } from '../core/remember.js';
import { findCollisionCandidatesForMemory } from '../core/collision-candidates.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { ValidationError } from '../core/types.js';
import type { Actor, IOperationLog } from '../operations/types.js';
import type { MemoryUsageTracker } from '../memory/usage-tracker.js';
import { BACKLOG_HOME_INPUT_FIELDS } from './home-input.js';

export interface BacklogRememberDeps {
  memoryComposer?: MemoryComposer;
  actor?: Actor;
  /** Intent journal (EXP-1 B-4): one operation row per successful remember. */
  operationLog?: IOperationLog;
  eventBus?: { emit: (event: any) => void };
  /** Records MEMO- citations in remembered content as strong usage (R-14). */
  usageTracker?: MemoryUsageTracker;
  /** Same-home service used only for the post-commit advisory scan. */
  service?: IBacklogService;
}

export function registerBacklogRememberTool(
  server: McpServer,
  deps?: BacklogRememberDeps,
): void {
  server.registerTool(
    'backlog_remember',
    {
      description:
        'Write a durable memory — a stable fact, a procedure, or a preference you should know next session. Use when you learn something worth keeping: "this repo deploys via wrangler", "Goga prefers terse evidence bullets". To CORRECT existing knowledge, pass supersedes (the old MEMO- id is expired, lineage kept) or state_key (previous holders of the same evolving fact are closed). The optional collision_candidates receipt is tri-state: [] means the advisory scan completed clean; a non-empty array means nearby facts deserve adjudication; absent means the advisory scan did not run or failed, not that the write failed. Do not use for task events — completions are captured automatically.',
      inputSchema: z.object({
        ...BACKLOG_HOME_INPUT_FIELDS,
        content: z.string().describe('The memory body (markdown) — the fact itself.'),
        title: z.string().describe('Memory title (required, like a task title) — a short human-readable label for the fact. Title and body are both first-class.'),
        layer: z.enum(['episodic', 'semantic', 'procedural']).optional().describe(
          'semantic = stable fact (default). procedural = how-to/process. episodic = a specific event worth keeping.',
        ),
        context: z.string().optional().describe('Scope container id (e.g. "FLDR-0001") — enables scoped recall and wakeup.'),
        tags: z.array(z.string()).optional().describe('Freeform labels for filterable recall.'),
        entity_refs: z.array(z.string()).optional().describe('Source entities this knowledge derives from (e.g. ["TASK-0676"]).'),
        kind: z.enum(['current', 'historical', 'plan', 'preference', 'timeless']).optional().describe(
          'Temporal kind: current fact / historical fact / future plan / preference / timeless (exempt from recency decay).',
        ),
        state_key: z.string().optional().describe(
          'Evolving-fact key (e.g. "build.bundler"). Storing a new memory with an existing key closes the previous holder.',
        ),
        occurred_at: z.string().optional().describe('When the remembered event occurred — ISO date/datetime. Decay uses this instead of write time.'),
        valid_until: z.string().optional().describe('Expiry — ISO date/datetime. After this the memory drops out of recall.'),
        supersedes: z.string().optional().describe('MEMO- id this memory replaces. The predecessor is soft-expired.'),
        derived: z.boolean().optional().describe('Mark as inference (consolidator output). Requires non-empty entity_refs citing the sources.'),
        as: z.string().min(1).optional().describe(
          'OPTIONAL agent identity to attribute this memory to — an AGENT- doc id or declared principal (e.g. "aime:granite"). First-person capture: pass your own identity, never another agent\'s. Absent: attribution is the ambient actor, unchanged.',
        ),
      }),
    },
    async (params) => {
      const candidateService = deps?.service;
      // ADR 0119 Slice A: an explicit `as` identity overlays the ambient
      // actor for this one write; absent, the actor is exactly deps.actor.
      const actor: Actor | undefined = params.as === undefined
        ? deps?.actor
        : { ...deps?.actor, type: 'agent', name: params.as };
      try {
        const result = await remember(
          {
            content: params.content,
            title: params.title,
            ...(params.layer !== undefined ? { layer: params.layer } : {}),
            ...(params.context !== undefined ? { context: params.context } : {}),
            ...(params.tags !== undefined ? { tags: params.tags } : {}),
            ...(params.entity_refs !== undefined ? { entity_refs: params.entity_refs } : {}),
            ...(params.kind !== undefined ? { kind: params.kind } : {}),
            ...(params.state_key !== undefined ? { state_key: params.state_key } : {}),
            ...(params.occurred_at !== undefined ? { occurred_at: params.occurred_at } : {}),
            ...(params.valid_until !== undefined ? { valid_until: params.valid_until } : {}),
            ...(params.supersedes !== undefined ? { supersedes: params.supersedes } : {}),
            ...(params.derived !== undefined ? { derived: params.derived } : {}),
          },
          {
            ...(deps?.memoryComposer ? { memoryComposer: deps.memoryComposer } : {}),
            ...(actor?.name ? { actorName: actor.name } : {}),
            ...(actor && deps?.operationLog
              ? {
                  journal: {
                    context: {
                      actor,
                      operationLog: deps.operationLog,
                      ...(deps.eventBus ? { eventBus: deps.eventBus } : {}),
                    },
                    tool: 'backlog_remember',
                  },
                }
              : {}),
            ...(candidateService === undefined
              ? {}
              : { findCollisionCandidates: function findCandidates(memoryId) {
                return findCollisionCandidatesForMemory(candidateService, memoryId);
              } }),
          },
        );
        // Citation signal (R-14): MEMO- ids referenced by the new memory's
        // content or entity_refs were evidently useful — bump them.
        if (deps?.usageTracker) {
          await deps.usageTracker.recordCitations(
            [params.content],
            (params.entity_refs ?? []).filter(r => r !== result.id),
          );
        }
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
