import type { Mutation, OperationEntry } from './types.js';

const LEGACY_MUTATIONS: Readonly<Record<string, Mutation>> = {
  backlog_create: 'create',
  backlog_update: 'update',
  backlog_delete: 'delete',
  write_resource: 'resource-edit',
};

/** Infer mutation class for operation entries written before ADR 0106.5. */
export function inferLegacyMutation(tool: string): Mutation | undefined {
  return LEGACY_MUTATIONS[tool];
}

/** Add a known legacy mutation class without rejecting unknown historical entries. */
export function normalizeOperationEntry(entry: OperationEntry): OperationEntry {
  if (entry.mutation !== undefined) return entry;
  const mutation = inferLegacyMutation(entry.tool);
  return mutation === undefined ? entry : { ...entry, mutation };
}
