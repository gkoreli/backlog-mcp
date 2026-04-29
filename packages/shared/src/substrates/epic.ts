/**
 * Epic substrate — groups related tasks.
 */
import { z } from 'zod';
import { BaseEntitySchema, StatusSchema, type SubstrateDefinition } from './base.js';

export const EpicSchema = BaseEntitySchema.extend({
  type: z.literal('epic'),
  status: StatusSchema.default('open'),
}).strict();

export type Epic = z.infer<typeof EpicSchema>;

export const EpicSubstrate = {
  type: 'epic',
  prefix: 'EPIC',
  label: 'Epic',
  schema: EpicSchema,
  structure: {
    isContainer: true,
    hasStatus: true,
    validParents: ['folder', 'milestone'],
  },
  extraFields: [],
  hint: 'Groups related tasks. status: open→in_progress→done. parent_id → folder or milestone.',
  ui: {
    gradient: 'linear-gradient(135deg, #f0b429, #ff6b2d)',
  },
} as const satisfies SubstrateDefinition<typeof EpicSchema>;
