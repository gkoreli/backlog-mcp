/**
 * Milestone substrate — time-bound target with a due date.
 *
 * Status uses the full STATUSES enum (not just open/done) — milestones can be
 * blocked or cancelled in practice.
 */
import { z } from 'zod';
import { BaseEntitySchema, StatusSchema, type SubstrateDefinition } from './base.js';

export const MilestoneSchema = BaseEntitySchema.extend({
  type: z.literal('milestone'),
  status: StatusSchema.default('open'),
  due_date: z.string().optional(),
}).strict();

export type Milestone = z.infer<typeof MilestoneSchema>;

export const MilestoneSubstrate = {
  type: 'milestone',
  prefix: 'MLST',
  label: 'Milestone',
  schema: MilestoneSchema,
  structure: {
    isContainer: true,
    hasStatus: true,
    validParents: ['folder'],
  },
  extraFields: ['due_date'],
  hint: 'Target date for deliverables. due_date for deadline. Tasks/epics can belong via parent_id.',
  ui: {
    gradient: 'linear-gradient(135deg, #f85149, #ff8c00)',
  },
} as const satisfies SubstrateDefinition<typeof MilestoneSchema>;
