import { z } from 'zod';

// ============================================================================
// Entity Types
// ============================================================================

export const ENTITY_TYPES = ['task', 'epic', 'folder', 'artifact', 'milestone'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

// ============================================================================
// Base Schema (shared by all)
// ============================================================================

const BaseSchema = z.object({
  id: z.string(),
  type: z.enum(ENTITY_TYPES),
  title: z.string().min(1),
  parent_id: z.string().optional(),
  description: z.string().optional(),
  references: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ============================================================================
// Substrate Schemas
// ============================================================================

export const TaskSchema = BaseSchema.extend({
  type: z.literal('task'),
  status: z.enum(STATUSES).default('open'),
  blocked_reason: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
});

export const EpicSchema = BaseSchema.extend({
  type: z.literal('epic'),
  status: z.enum(STATUSES).default('open'),
});

export const FolderSchema = BaseSchema.extend({
  type: z.literal('folder'),
});

export const ArtifactSchema = BaseSchema.extend({
  type: z.literal('artifact'),
  content_type: z.string().optional(), // e.g., 'text/markdown', 'application/json'
  path: z.string().optional(), // file path if external
});

export const MilestoneSchema = BaseSchema.extend({
  type: z.literal('milestone'),
  due_date: z.string().datetime().optional(),
  status: z.enum(['open', 'done']).default('open'),
});

// ============================================================================
// Substrate Registry
// ============================================================================

export interface SubstrateConfig {
  prefix: string;
  schema: z.ZodSchema;
  validParents: EntityType[];
  hint: string;
}

export const SUBSTRATES: Record<EntityType, SubstrateConfig> = {
  task: {
    prefix: 'TASK',
    schema: TaskSchema,
    validParents: ['task', 'epic', 'folder', 'milestone'],
    hint: 'Work item. status: open→in_progress→done. parent_id → task (=subtask), epic, folder, or milestone.',
  },
  epic: {
    prefix: 'EPIC',
    schema: EpicSchema,
    validParents: ['folder', 'milestone'],
    hint: 'Groups related tasks. status: open→in_progress→done. parent_id → folder or milestone.',
  },
  folder: {
    prefix: 'FLDR',
    schema: FolderSchema,
    validParents: ['folder'],
    hint: 'Organizes items. Set parent_id on other items to put them here. Can nest.',
  },
  artifact: {
    prefix: 'ARTF',
    schema: ArtifactSchema,
    validParents: ['task', 'epic', 'folder'],
    hint: 'File or resource. Attach to task/epic/folder via parent_id. Optional: content_type, path.',
  },
  milestone: {
    prefix: 'MLST',
    schema: MilestoneSchema,
    validParents: ['folder'],
    hint: 'Target date for deliverables. due_date for deadline. Tasks/epics can belong via parent_id.',
  },
};

// ============================================================================
// Type Inference
// ============================================================================

export type Task = z.infer<typeof TaskSchema>;
export type Epic = z.infer<typeof EpicSchema>;
export type Folder = z.infer<typeof FolderSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;

export type Entity = Task | Epic | Folder | Artifact | Milestone;

// ============================================================================
// Schema Hints (first-encounter learning)
// ============================================================================

const seenTypes = new Set<EntityType>();

export function getSchemaHintOnce(type: EntityType): string {
  if (seenTypes.has(type)) return '';
  seenTypes.add(type);
  return `\n\n_Schema: **${type}** - ${SUBSTRATES[type].hint}_`;
}

export function resetSeenTypes(): void {
  seenTypes.clear();
}

// ============================================================================
// ID Utilities
// ============================================================================

export function formatEntityId(num: number, type: EntityType): string {
  return `${SUBSTRATES[type].prefix}-${num.toString().padStart(4, '0')}`;
}

export function parseEntityId(id: string): { type: EntityType; num: number } | null {
  for (const [type, config] of Object.entries(SUBSTRATES)) {
    const pattern = new RegExp(`^${config.prefix}-(\\d{4,})$`);
    const match = pattern.exec(id);
    if (match?.[1]) {
      return { type: type as EntityType, num: parseInt(match[1], 10) };
    }
  }
  return null;
}
