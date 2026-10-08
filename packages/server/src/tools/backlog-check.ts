/** MCP presentation of the shared selected-home corpus check (ADR 0113.4). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CorpusCheckerPort } from '../core/corpus-check.contract.js';
import { BACKLOG_HOME_INPUT_FIELDS } from './home-input.js';

/** Return diagnostics as a successful read; reserve isError for inability to run. */
export function registerBacklogCheckTool(server: McpServer, checker: CorpusCheckerPort): void {
  server.registerTool('backlog_check', {
    description: 'Check authored YAML frontmatter, substrate schemas, identities and declared relations in the selected home. Read-only: returns deterministic diagnostics without repairing files.',
    inputSchema: z.object({ ...BACKLOG_HOME_INPUT_FIELDS }),
  }, async function checkSelectedCorpus() {
    try {
      const report = await checker.check();
      return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  });
}
