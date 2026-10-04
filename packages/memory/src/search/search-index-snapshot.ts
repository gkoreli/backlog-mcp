/** Derived-cache format boundary; authoritative custom entity fields remain open. */
import type { save } from '@orama/orama';
import type { AnyEntity } from '@backlog-mcp/shared';
import type { Resource, SearchEntityField } from './types.js';

/** Existing cache format, not an authoritative document or a second source of truth. */
export interface SearchIndexSnapshot {
  version: number;
  index: ReturnType<typeof save>;
  tasks: Record<string, AnyEntity>;
  entityFields: Record<string, readonly SearchEntityField[]>;
  resources: Record<string, Resource>;
  hasEmbeddings: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEntity(value: unknown, id: string): value is AnyEntity {
  return isRecord(value) && value.id === id && typeof value.title === 'string' && typeof value.type === 'string';
}

function isResource(value: unknown, id: string): value is Resource {
  return isRecord(value) && value.id === id && typeof value.title === 'string'
    && typeof value.path === 'string' && typeof value.content === 'string'
    && (value.status === undefined || typeof value.status === 'string');
}

function isFields(value: unknown): value is SearchEntityField[] {
  return Array.isArray(value) && value.every(function namedField(field) {
    return isRecord(field) && typeof field.name === 'string';
  });
}

function isStoredIndex(value: unknown): value is SearchIndexSnapshot['index'] {
  // Orama owns internal decoding; the service checks observable document coherence. This wrapper
  // only verifies the serialization envelope and our installed English pipeline.
  return isRecord(value) && value.language === 'english'
    && ['internalDocumentIDStore', 'index', 'docs', 'sorting', 'pinning'].every(function present(key) { return key in value; });
}

/** Parse cache envelopes once, without canonicalizing or validating native entity schemas. */
export function parseSearchIndexSnapshot(value: unknown, version: number): SearchIndexSnapshot | undefined {
  if (!isRecord(value) || value.version !== version || !isStoredIndex(value.index) || !isRecord(value.tasks)) return undefined;
  if (value.hasEmbeddings !== undefined && typeof value.hasEmbeddings !== 'boolean') return undefined;
  const fields = value.entityFields ?? {};
  const resources = value.resources ?? {};
  if (!isRecord(fields) || !isRecord(resources)) return undefined;
  const tasks: Record<string, AnyEntity> = {};
  const entityFields: Record<string, readonly SearchEntityField[]> = {};
  const resourceEntries: Record<string, Resource> = {};
  for (const [id, entity] of Object.entries(value.tasks)) {
    if (!isEntity(entity, id)) return undefined;
    Object.defineProperty(tasks, id, { value: entity, enumerable: true });
  }
  for (const [id, projection] of Object.entries(fields)) {
    if (!isFields(projection) || !Object.hasOwn(tasks, id)) return undefined;
    Object.defineProperty(entityFields, id, { value: projection, enumerable: true });
  }
  for (const [id, resource] of Object.entries(resources)) {
    if (!isResource(resource, id) || Object.hasOwn(tasks, id)) return undefined;
    Object.defineProperty(resourceEntries, id, { value: resource, enumerable: true });
  }
  return { version, index: value.index, tasks, entityFields, resources: resourceEntries, hasEmbeddings: value.hasEmbeddings === true };
}
