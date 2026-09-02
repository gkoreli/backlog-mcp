import type { IBacklogService } from '../storage/backlog-service.contract.js';

/**
 * The one way to name a document (ADR 0129.1).
 *
 * Every retrieval surface — the `get` tool, the CLI, the HTTP resource
 * proxy, the viewer's split pane — accepts the same three spellings and
 * resolves them here, never by synthesizing a path from an id:
 *
 * - an entity id (`TASK-0092`, `MEMO-0010`): resolved through storage to the
 *   document's real source path, wherever it lives (sub-folder, slug, human
 *   filename — ADR 0112 R-6, ADR 0129 R1);
 * - a root-relative document path (`README.md`, `docs/adr/0001-x.md`):
 *   aliased to its canonical resource URI;
 * - a resource URI (`mcp://backlog/docs/adr/0001-x.md`): used as is.
 */
export type DocumentAddress =
  | { kind: 'entity'; id: string }
  | { kind: 'resource'; uri: string };

const RESOURCE_URI_PREFIX = 'mcp://backlog/';

/**
 * A slash or an alphabetic extension marks a path. The extension must be
 * alphabetic so threaded ids such as `ADR 0113.1` stay entities.
 */
function looksLikePath(value: string): boolean {
  return value.includes('/') || /\.[A-Za-z]+$/u.test(value);
}

/**
 * Classify one address string. Paths alias to their resource URI (EXP-1
 * rerun P2: wakeup advertises root-relative paths, so `get README.md` must
 * resolve exactly like `get mcp://backlog/README.md`); anything that is
 * neither a URI nor path-shaped stays on the entity lane.
 */
export function parseDocumentAddress(input: string): DocumentAddress {
  const trimmed = input.trim();
  if (trimmed.startsWith(RESOURCE_URI_PREFIX)) {
    return { kind: 'resource', uri: trimmed };
  }
  const normalized = trimmed.replace(/^\.\//u, '').replace(/^\/+/u, '');
  if (normalized !== '' && looksLikePath(normalized)) {
    return { kind: 'resource', uri: `${RESOURCE_URI_PREFIX}${normalized}` };
  }
  return { kind: 'entity', id: trimmed };
}

/**
 * Resolve an address to the resource URI that reads it, or `null` when the
 * entity has no document in this home. Entity resolution rides the
 * service's own storage lookup, so it follows the document to any folder or
 * filename the home uses.
 */
export function resolveDocumentUri(
  service: Pick<IBacklogService, 'getResourceUri'>,
  address: DocumentAddress,
): string | null {
  if (address.kind === 'resource') return address.uri;
  return service.getResourceUri?.(address.id) ?? null;
}
