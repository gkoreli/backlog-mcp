import type {
  AnyEntity,
} from '@backlog-mcp/shared';
import type {
  SearchEntityDocument,
} from '@backlog-mcp/memory/search';
import {
  createSearchEntityDocument,
} from '../../core/substrates/create-search-entity-document.js';

/** Project a built-in test fixture through the same search boundary as production. */
export function searchDocument(entity: AnyEntity): SearchEntityDocument {
  const document = createSearchEntityDocument(entity);
  if (!document) {
    throw new Error(`Test entity is not search-projectable: ${entity.id}`);
  }
  return document;
}

export function searchDocuments(
  entities: readonly AnyEntity[],
): SearchEntityDocument[] {
  return entities.map(searchDocument);
}
