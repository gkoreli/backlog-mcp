/**
 * Folder substrate — organizational container. No status; pure grouping.
 */
import { z } from 'zod';
import { BaseEntitySchema, type SubstrateDefinition } from './base.js';

export const FolderSchema = BaseEntitySchema.extend({
  type: z.literal('folder'),
}).strict();

export type Folder = z.infer<typeof FolderSchema>;

export const FolderSubstrate = {
  type: 'folder',
  prefix: 'FLDR',
  label: 'Folder',
  schema: FolderSchema,
  structure: {
    isContainer: true,
    hasStatus: false,
    validParents: ['folder'],
  },
  extraFields: [],
  hint: 'Organizes items. Set parent_id on other items to put them here. Can nest.',
  ui: {
    gradient: 'linear-gradient(135deg, #3fb950, #1f883d)',
  },
} as const satisfies SubstrateDefinition<typeof FolderSchema>;
