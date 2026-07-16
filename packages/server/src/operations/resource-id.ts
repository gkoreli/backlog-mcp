import type { Mutation } from './types.js';

/**
 * Extract a display filename for write_resource operations.
 * Handles both old URI format and new ID format.
 *
 * Old: { uri: "mcp://backlog/tasks/TASK-0001.md" } → "TASK-0001.md"
 * New: { id: "TASK-0001" }                         → "TASK-0001.md"
 *
 * Returns undefined for non-write_resource tools.
 */
export function extractTargetFilename(
  mutation: Mutation | undefined,
  params: Record<string, unknown>,
): string | undefined {
  if (mutation !== 'resource-edit') return undefined;
  const uri = params.uri as string | undefined;
  if (uri) return uri.split('/').pop() ?? undefined;
  const id = params.id as string | undefined;
  return id ? `${id}.md` : undefined;
}
