/** Lossless historical operation interpretation; journal I/O stays outside core (ADR 0136). */
import type { Mutation, OperationEntry } from './operation-log.contract.js';

const LEGACY_MUTATIONS = new Map<string, Mutation>([
  ['backlog_create', 'create'],
  ['backlog_update', 'update'],
  ['backlog_delete', 'delete'],
  ['write_resource', 'resource-edit'],
]);

/** Interpret known historical tools while retaining unknown vocabulary. */
export function inferLegacyMutation(tool: string): Mutation | undefined {
  return LEGACY_MUTATIONS.get(tool);
}

/** Add a known legacy mutation without rewriting the original operation. */
export function normalizeOperationEntry(entry: OperationEntry): OperationEntry {
  if (entry.mutation !== undefined) return entry;
  const mutation = inferLegacyMutation(entry.tool);
  return mutation === undefined ? entry : { ...entry, mutation };
}

/** Retain the legacy resource-edit display filename contract, without inventing a storage path. */
export function extractTargetFilename(mutation: Mutation | undefined, params: Record<string, unknown>): string | undefined {
  if (mutation !== 'resource-edit') return undefined;
  if (typeof params.uri === 'string' && params.uri) return params.uri.split('/').pop();
  return typeof params.id === 'string' && params.id ? `${params.id}.md` : undefined;
}
