/**
 * Cron substrate — scheduled intake descriptor.
 *
 * Design notes:
 *   - `schedule` is a 5-field numeric cron expression (see isValidCronExpression).
 *   - `command` is an opaque string; an external scheduler decides how to execute it.
 *     backlog-mcp stores, never orchestrates (ADR 0097).
 *   - `enabled` is SEPARATE from `status`. A cron can be `enabled=true status=done`
 *     to mean "completed intake we're preserving for audit" vs `enabled=false status=open`
 *     to mean "paused but still active work." Never overload status.
 *   - `last_run` / `next_run` are scheduler-owned. They are nullable/optional on the schema
 *     so the scheduler can clear them (e.g. on disable).
 */
import { z } from 'zod';
import { BaseEntitySchema, StatusSchema, type SubstrateDefinition } from './base.js';
import { isValidCronExpression } from '../cron-expression.js';

export const CronSchema = BaseEntitySchema.extend({
  type: z.literal('cron'),
  status: StatusSchema.default('open'),
  schedule: z.string().refine(isValidCronExpression, {
    message: 'Invalid cron expression — expected 5 numeric fields (min hour dom month dow).',
  }),
  command: z.string().min(1, 'command is required'),
  enabled: z.boolean().default(true),
  last_run: z.string().nullable().optional(),
  next_run: z.string().nullable().optional(),
}).strict();

export type Cron = z.infer<typeof CronSchema>;

export const CronSubstrate = {
  type: 'cron',
  prefix: 'CRON',
  label: 'Cron',
  schema: CronSchema,
  structure: {
    isContainer: false,
    hasStatus: true,
    validParents: ['epic', 'folder'],
  },
  extraFields: ['schedule', 'command', 'enabled', 'last_run', 'next_run'],
  hint: 'Scheduled intake descriptor. Requires schedule (5-field cron expr) and command. Executed by an external scheduler — see ADR 0097. `enabled` is separate from `status`.',
  ui: {
    gradient: 'linear-gradient(135deg, #17c0ba, #2da44e)',
  },
} as const satisfies SubstrateDefinition<typeof CronSchema>;
