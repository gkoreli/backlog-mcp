import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IBacklogService } from '../storage/service-types.js';
import { wakeup } from '../core/wakeup.js';
import { ValidationError } from '../core/types.js';
import { paths } from '../utils/paths.js';

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
}

const IDENTITY_FILENAME = 'identity.md';

/**
 * Transport-layer identity reader.
 * Core stays IO-free (ADR-0090) — filesystem read is wired here, injected
 * into the core function via ``readIdentity``.
 */
function readIdentityFile(): string | undefined {
  const path = join(paths.backlogDataDir, IDENTITY_FILENAME);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, 'utf-8').trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * backlog_wakeup — Session-start briefing (ADR-0092.1 Phase 2).
 *
 * Returns a ~600-token "what am I working on?" payload — active tasks,
 * current epics, recent completions with evidence snippets, recent activity.
 * Optional ``scope`` narrows everything to a folder/milestone/epic subtree
 * (use a Folder ID for project-scoped wake-up).
 *
 * Distinct from ``backlog_context``: that tool hydrates around a specific
 * focal entity. Wakeup is time-oriented and needs no focal entity.
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
        'Dense session-start briefing: active tasks, current epics, recent completions (with evidence snippets), and recent activity. No focal entity required — use this at the start of every session to understand what you were working on. Optional `scope` narrows to a folder (for project-scoped briefing), milestone, or epic.',
      inputSchema: z.object({
        scope: z.string().optional().describe(
          'Optional entity ID to scope the briefing to a subtree. Must be a container (folder/milestone/epic). Use a folder ID for project-scoped wake-up (e.g. "FLDR-0001"). Omit to get everything across the whole backlog.',
        ),
        max_completions: z.number().min(0).max(50).optional().describe(
          'Max done tasks in the "recent" section. Default: 5.',
        ),
        max_activity: z.number().min(0).max(50).optional().describe(
          'Max recent activity-log entries. Default: 5.',
        ),
        evidence_snippet_chars: z.number().min(40).max(1000).optional().describe(
          'Max chars of evidence to include per completion. Default: 160.',
        ),
      }),
    },
    async ({ scope, max_completions, max_activity, evidence_snippet_chars }) => {
      try {
        const result = await wakeup(service, {
          ...(scope !== undefined ? { scope } : {}),
          ...(max_completions !== undefined ? { maxCompletions: max_completions } : {}),
          ...(max_activity !== undefined ? { maxActivity: max_activity } : {}),
          ...(evidence_snippet_chars !== undefined ? { evidenceSnippetChars: evidence_snippet_chars } : {}),
          readIdentity: readIdentityFile,
          ...(deps?.operationLogger
            ? { readOperations: (o) => deps.operationLogger!.read(o) }
            : {}),
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
