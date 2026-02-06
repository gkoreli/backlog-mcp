import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storage } from '../storage/backlog-service.js';
import {
  ENTITY_TYPES,
  SUBSTRATES,
  getSchemaHintOnce,
  formatEntityId,
  type Entity,
} from '../substrates/index.js';

export function registerBacklogCreateV2Tool(server: McpServer) {
  server.registerTool(
    'backlog_create_v2',
    {
      description:
        'Create item (task/epic/folder/artifact/milestone). Use parent_id to organize or create subtasks.',
      inputSchema: z.object({
        type: z.enum(ENTITY_TYPES).default('task').describe('Type: task, epic, folder, artifact, milestone'),
        title: z.string().describe('Title'),
        parent_id: z.string().optional().describe('Parent ID (task→task=subtask, →epic/folder/milestone=belongs)'),
        description: z.string().optional().describe('Description (markdown)'),
        references: z
          .array(z.object({ url: z.string(), title: z.string().optional() }))
          .optional()
          .describe('Reference links'),
      }),
    },
    async ({ type = 'task', title, parent_id, description, references }) => {
      const config = SUBSTRATES[type];
      const maxId = storage.getMaxId(type === 'task' || type === 'epic' ? type : undefined);
      const id = formatEntityId(maxId + 1, type);
      const now = new Date().toISOString();

      const entity: Record<string, unknown> = {
        id,
        type,
        title,
        created_at: now,
        updated_at: now,
      };

      // Status for types that have it
      if (type === 'task' || type === 'epic' || type === 'milestone') {
        entity.status = 'open';
      }

      // Common optional fields
      if (parent_id) entity.parent_id = parent_id;
      if (description) entity.description = description;
      if (references?.length) entity.references = references;

      storage.add(entity as Entity);

      return {
        content: [{ type: 'text', text: `Created ${id}` + getSchemaHintOnce(type) }],
      };
    }
  );
}
