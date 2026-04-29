/**
 * Artifact substrate — file or resource attached to another entity.
 */
import { z } from 'zod';
import { BaseEntitySchema, type SubstrateDefinition } from './base.js';

export const ArtifactSchema = BaseEntitySchema.extend({
  type: z.literal('artifact'),
  content_type: z.string().optional(),
  path: z.string().optional(),
}).strict();

export type Artifact = z.infer<typeof ArtifactSchema>;

export const ArtifactSubstrate = {
  type: 'artifact',
  prefix: 'ARTF',
  label: 'Artifact',
  schema: ArtifactSchema,
  structure: {
    isContainer: false,
    hasStatus: false,
    validParents: ['task', 'epic', 'folder'],
  },
  extraFields: ['content_type', 'path'],
  hint: 'File or resource. Attach to task/epic/folder via parent_id. Optional: content_type, path.',
  ui: {
    gradient: 'linear-gradient(135deg, #a371f7, #ff2d7b)',
    opensInPane: true,
  },
} as const satisfies SubstrateDefinition<typeof ArtifactSchema>;
