/** Native architectural decision substrate (ADR 0113.2). */
import { z } from 'zod';
import { BaseEntitySchema, type SubstrateDefinition } from './base.js';

export const ADR_STATUSES = ['draft', 'proposed', 'living', 'accepted', 'deferred', 'rejected', 'superseded'] as const;
const decisionRefs = z.array(z.string().max(500)).max(100).optional();

// Keep the previous managed ADR field order so canonical publication stays compatible.
export const AdrSchema = z.object({
  id: BaseEntitySchema.shape.id,
  type: z.literal('adr'),
  title: z.string().min(1).max(300),
  content: z.string().max(2_000_000),
  // Pre-promotion managed ADRs did not require timestamps. New core writes stamp them.
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  status: z.enum(ADR_STATUSES),
  date: z.iso.date().optional(),
  supersedes: decisionRefs,
  extends: decisionRefs,
  implements: decisionRefs,
  backlog_item: decisionRefs,
  spawned_by: decisionRefs,
  respects: decisionRefs,
  violates: decisionRefs,
  description: z.string().trim().min(1).max(320).optional()
    .describe('Short authored discovery description, targeting roughly 50 tokens; required by the propose action'),
  parent_id: BaseEntitySchema.shape.parent_id,
  references: BaseEntitySchema.shape.references,
  blocked_reason: BaseEntitySchema.shape.blocked_reason,
  evidence: BaseEntitySchema.shape.evidence,
}).strict();

export type Adr = z.infer<typeof AdrSchema>;

export const AdrSubstrate = {
  type: 'adr', prefix: 'ADR', label: 'ADR', schema: AdrSchema,
  identity: { strategy: 'numbered-threaded', minimumDigits: 4, displayTemplate: 'ADR {key}' },
  structure: { isContainer: false, hasStatus: true, validParents: [] },
  extraFields: ['description', 'date', 'extends', 'supersedes'],
  hint: 'Architectural decision. Discover its short description and thread before loading the body; use declared propose, accept and supersede actions.',
  ui: { gradient: 'linear-gradient(135deg, #d29922, #e3b341)', opensInPane: true },
} as const satisfies SubstrateDefinition<typeof AdrSchema>;
