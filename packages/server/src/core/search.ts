import type { AnyEntity } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import type { Resource, SearchableType } from '@backlog-mcp/memory/search';
import { ValidationError, type SearchParams, type SearchResult, type SearchResultItem } from './types.js';

function isResource(type: string): boolean {
  return type === 'resource';
}

export async function searchItems(service: IBacklogService, params: SearchParams): Promise<SearchResult> {
  const { query, types, status, parent_id, sort, limit, include_content, include_scores } = params;

  if (!query.trim()) throw new ValidationError('Query must not be empty');

  const results = await service.searchUnified(query, {
    types: types as SearchableType[] | undefined,
    status,
    parent_id,
    sort: sort ?? 'relevant',
    limit: limit ?? 20,
  });

  const searchMode = service.isHybridSearchActive?.() ?? false ? 'hybrid' : 'bm25';

  const formattedResults: SearchResultItem[] = results.map(r => {
    if (isResource(r.type)) {
      const resource = r.item as Resource;
      const item: SearchResultItem = {
        id: resource.id,
        title: resource.title,
        type: 'resource',
        path: resource.path,
        // Declared frontmatter status flows into the stub (BUG-0003) so an
        // agent can see resolved vs open work without hydrating the body.
        ...(typeof resource.status === 'string' ? { status: resource.status } : {}),
      };
      if (r.snippet) { item.snippet = r.snippet.text; item.matched_fields = r.snippet.matched_fields; }
      if (include_scores) item.score = Math.round(r.score * 1000) / 1000;
      if (include_content) item.content = resource.content;
      return item;
    }

    const entity = r.item as AnyEntity;
    const status = typeof entity.status === 'string' ? entity.status : undefined;
    const item: SearchResultItem = {
      id: entity.id,
      title: entity.title,
      type: r.type,
      ...(status === undefined ? {} : { status }),
    };
    const parentId = entity.parent_id;
    if (parentId) item.parent_id = parentId;
    if (r.snippet) { item.snippet = r.snippet.text; item.matched_fields = r.snippet.matched_fields; }
    if (include_scores) item.score = Math.round(r.score * 1000) / 1000;
    if (include_content && typeof entity.content === 'string') {
      item.content = entity.content;
    }
    return item;
  });

  return { results: formattedResults, total: formattedResults.length, query, search_mode: searchMode };
}
