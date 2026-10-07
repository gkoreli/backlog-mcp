/** Bounded description/frontmatter projections without body hydration (ADR 0113.2). */
import type { AnyEntity } from '@backlog-mcp/shared';
import type { DocumentDiscoveryPort, DocumentDiscoveryResult } from './document-discovery.contract.js';

const MAX_DISCOVERY_STRING = 320;
const MAX_DISCOVERY_ARRAY = 10;
const RESERVED_FIELDS = new Set(['id', 'type', 'title', 'status', 'content', 'parent_id']);

/** Project bounded, declared scalar metadata without bodies (ADR 0113.2 R3). */
export function projectDocumentDiscovery(entity: AnyEntity, port: DocumentDiscoveryPort): DocumentDiscoveryResult {
  const projection = port.getDiscoveryProjection?.(entity.type);
  if (projection === undefined) return {};
  const result: DocumentDiscoveryResult = { ...port.getDocumentDiscovery?.(entity.id) };
  const metadata: Record<string, unknown> = {};
  function compact(value: unknown): unknown {
    if (typeof value === 'string') {
      if (value.length > MAX_DISCOVERY_STRING) result.discovery_truncated = true;
      return value.slice(0, MAX_DISCOVERY_STRING);
    }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    return undefined;
  }
  const record = entity as Record<string, unknown>;
  for (const field of projection) {
    if (RESERVED_FIELDS.has(field)) continue;
    const value = record[field];
    if (field === 'description') {
      const description = compact(value);
      if (typeof description === 'string') result.description = description;
    } else if (Array.isArray(value)) {
      if (value.length > MAX_DISCOVERY_ARRAY) result.discovery_truncated = true;
      metadata[field] = value.slice(0, MAX_DISCOVERY_ARRAY).map(compact).filter(function defined(item) { return item !== undefined; });
    } else {
      const projected = compact(value);
      if (projected !== undefined) metadata[field] = projected;
    }
  }
  if (Object.keys(metadata).length > 0) result.metadata = metadata;
  return result;
}
