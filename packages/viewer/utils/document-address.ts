import { isValidEntityId } from '@backlog-mcp/shared';

/**
 * A split-pane document address (ADR 0129.1): either a resource URI
 * (`mcp://backlog/docs/adr/0001-x.md`) or a bare entity id (`TASK-0092`).
 * The server resolves both through one grammar; the viewer never builds a
 * path from an id, because documents live wherever their home puts them.
 */
export function isDocumentAddress(value: string): boolean {
  return value.startsWith('mcp://') || isValidEntityId(value);
}
