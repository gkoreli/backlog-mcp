/**
 * Task substrate — work items with full workflow status.
 *
 * Task-specific fields (blocked_reason, evidence) live on BaseEntitySchema
 * because they're accessed generically throughout the codebase. The schema
 * still constrains them to task semantics.
 */
import { z } from 'zod';
import { BaseEntitySchema, StatusSchema, type SubstrateDefinition } from './base.js';

export const TaskSchema = BaseEntitySchema.extend({
  type: z.literal('task'),
  status: StatusSchema.default('open'),
}).strict();

export type Task = z.infer<typeof TaskSchema>;

export const TaskSubstrate = {
  type: 'task',
  prefix: 'TASK',
  label: 'Task',
  schema: TaskSchema,
  structure: {
    isContainer: false,
    hasStatus: true,
    validParents: ['task', 'epic', 'folder', 'milestone'],
  },
  extraFields: ['blocked_reason', 'evidence'],
  hint: 'Work item. status: open→in_progress→done. parent_id → task (=subtask), epic, folder, or milestone.',
  ui: {
    gradient: 'linear-gradient(135deg, #00d4ff, #7b2dff)',
  },
} as const satisfies SubstrateDefinition<typeof TaskSchema>;
