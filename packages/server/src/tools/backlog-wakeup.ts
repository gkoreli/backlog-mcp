import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryEntry } from '@backlog-mcp/memory';
import type { Memory } from '@backlog-mcp/shared';
import { z } from 'zod';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { wakeup } from '../core/wakeup.js';
import { ValidationError, type WakeupGrounding } from '../core/types.js';
import type { HomeReadCoordinator } from '../core/home-read-coordinator.types.js';
import type { ProjectSubstrateRegistry } from '../core/substrates/project-substrate-registry.js';
import {
  BACKLOG_READ_HOME_INPUT_FIELDS,
  requireHomeReadCoordinator,
} from './home-input.js';

export interface BacklogWakeupDeps {
  operationLogger?: {
    read: (options: { limit?: number }) => Array<{
      ts: string;
      tool: string;
      params: Record<string, unknown>;
      resourceId?: string;
      actor: { type: string; name: string };
    }>;
  };
  readLocalFile?: (filePath: string) => string | null;
  identityPath?: string;
  visionPath?: string;
  /** First-impression grounding reader (charter Slices A/B). */
  readGrounding?: () => WakeupGrounding | undefined;
  mintMemoryEntry?: (memory: Memory) => MemoryEntry;
  substrateRegistry?: Pick<ProjectSubstrateRegistry, 'acceptsParent'>;
  homeReadCoordinator?: HomeReadCoordinator;
}

/**
 * backlog_wakeup — Session-start briefing (ADR-0092.1 Phase 2).
 *
 * Returns a ~600-token "what am I working on?" payload — active tasks,
 * current epics, recent completions with evidence snippets, recent activity.
 * Optional ``scope`` narrows everything to a folder/milestone/epic subtree
 * (use a Folder ID for project-scoped wake-up).
 *
 * Wakeup is time-oriented and needs no focal entity. Use
 * ``backlog_get({ context: true })`` to expand a specific entity.
 */
export function registerBacklogWakeupTool(
  server: McpServer,
  service: IBacklogService,
  deps?: BacklogWakeupDeps,
): void {
  server.registerTool(
    'backlog_wakeup',
    {
      description:
        'Dense session-start briefing: active tasks, current epics, project constraints (requirements as stubs, violated/at-risk first — treat these as standing product intent), recent completions (with evidence snippets), recent activity, and the home-wide unfiled work count. No focal entity required — use this at the start of every session to understand what you were working on. Optional `scope` narrows the entity sections to a folder, milestone, or epic; unfiled remains home-wide because parentless work has no subtree ancestry.',
      // The Cold-Open Test makes wakeup the product's one always-visible door.
      // Every other tool stays deferred under Tenet 8 until the briefing teaches it.
      _meta: {
        'anthropic/alwaysLoad': true,
      },
      inputSchema: z.object({
        ...BACKLOG_READ_HOME_INPUT_FIELDS,
        scope: z.string().optional().describe(
          'Optional entity ID to scope the briefing to a subtree. Must be a container (folder/milestone/epic). Use a folder ID for project-scoped wake-up (e.g. "FLDR-0001"). Omit to get everything across the whole backlog.',
        ),
        max_completions: z.number().min(0).max(50).optional().describe(
          'Max done tasks in the "recent" section. Default: 5.',
        ),
        max_activity: z.number().min(0).max(50).optional().describe(
          'Max recent activity-log entries. Default: 5.',
        ),
        max_constraints: z.number().min(0).max(50).optional().describe(
          'Max requirement constraint stubs. Default: 5; 0 disables. Truncation is reported via metadata.constraints_omitted.',
        ),
        evidence_snippet_chars: z.number().min(40).max(1000).optional().describe(
          'Max chars of evidence to include per completion. Default: 160.',
        ),
      }),
    },
    async ({
      home,
      project_root,
      scope,
      max_completions,
      max_activity,
      max_constraints,
      evidence_snippet_chars,
    }) => {
      try {
        const wakeupParams = {
          ...(scope !== undefined ? { scope } : {}),
          ...(max_completions !== undefined ? { maxCompletions: max_completions } : {}),
          ...(max_activity !== undefined ? { maxActivity: max_activity } : {}),
          ...(max_constraints !== undefined ? { maxConstraints: max_constraints } : {}),
          ...(evidence_snippet_chars !== undefined ? { evidenceSnippetChars: evidence_snippet_chars } : {}),
        };
        if (home === 'all') {
          const result = await requireHomeReadCoordinator(
            deps?.homeReadCoordinator,
          ).wakeup(
            wakeupParams,
            project_root === undefined
              ? undefined
              : { projectRoot: project_root },
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }],
          };
        }

        const operationLogger = deps?.operationLogger;
        const readIdentity = (): string | undefined => {
          if (!deps?.readLocalFile || !deps?.identityPath) return undefined;
          const raw = deps.readLocalFile(deps.identityPath);
          return raw?.trim() || undefined;
        };
        const readVision = (): string | undefined => {
          if (!deps?.readLocalFile || !deps?.visionPath) return undefined;
          const raw = deps.readLocalFile(deps.visionPath);
          return raw?.trim() || undefined;
        };

        const result = await wakeup(service, {
          ...wakeupParams,
          readIdentity,
          ...(deps?.readGrounding === undefined
            ? {}
            : { readGrounding: deps.readGrounding }),
          ...(deps?.substrateRegistry === undefined
            ? {}
            : {
                acceptsParent: function acceptsParent(type: string): boolean {
                  return deps.substrateRegistry?.acceptsParent(type) === true;
                },
              }),
          readVision,
          ...(operationLogger
            ? { readOperations: (options) => operationLogger.read(options) }
            : {}),
          ...(deps?.mintMemoryEntry === undefined
            ? {}
            : { mintMemoryEntry: deps.mintMemoryEntry }),
        });
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
