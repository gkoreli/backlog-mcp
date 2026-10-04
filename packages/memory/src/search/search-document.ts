/** Pure searchable/filter and embedding representations; payloads remain lossless (ADR 0136 R4). */
import { statusToken } from '@backlog-mcp/shared';
import type { Resource, SearchEntityDocument } from './types.js';

/** Registry already selected these named fields; this projection never guesses extras. */
export type EntityProjectionSource = Pick<SearchEntityDocument, 'entity' | 'fields'>;

/** Engine-independent values consumed by the Orama schema adapter. */
export interface SearchDocumentProjection {
  id: string;
  title: string;
  content: string;
  status: string;
  type: string;
  parent_id: string;
  evidence: string;
  blocked_reason: string;
  references: string;
  search_text: string;
  path: string;
  updated_at: string;
}

/** Flatten declared field values deterministically, preserving the established text contract. */
export function searchFieldText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(searchFieldText).filter(Boolean).join(' ');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** Embeddings depend on declared field text, independently of filter/payload changes. */
export function entityEmbeddingText(document: EntityProjectionSource): string {
  return document.fields
    .map(function fieldText(field) {
      return searchFieldText(field.value);
    })
    .join(' ')
    .trim();
}

/** Project named entity fields and filter metadata without mutating authoritative data. */
export function projectEntitySearchDocument(document: EntityProjectionSource): SearchDocumentProjection {
  const task = document.entity;
  const fields = new Map(document.fields.map(function fieldEntry(field) {
    return [field.name, searchFieldText(field.value)];
  }));
  const dedicatedFields = new Set([
    'title',
    'content',
    'evidence',
    'blocked_reason',
    'references',
  ]);

  return {
    id: task.id,
    title: fields.get('title') ?? '',
    content: fields.get('content') ?? '',
    // Leading-token normalization (BUG-0003): declared workflow states are
    // freeform ("Accepted (goga, 2026-07-16)") — index the shared token so
    // `--status accepted` matches. Raw status stays on the cached entity.
    status: statusToken(task.status) ?? '',
    type: typeof task.type === 'string' ? task.type : 'task',
    parent_id: typeof task.parent_id === 'string' ? task.parent_id : '',
    evidence: fields.get('evidence') ?? '',
    blocked_reason: fields.get('blocked_reason') ?? '',
    references: fields.get('references') ?? '',
    search_text: document.fields
      .filter(function isGenericSearchField(field) {
        return !dedicatedFields.has(field.name);
      })
      .map(function fieldText(field) {
        return searchFieldText(field.value);
      }).join(' '),
    path: '',  // Tasks don't have paths
    updated_at: typeof task.updated_at === 'string' ? task.updated_at : '',
  };
}

/** Project a native unclaimed resource with its declared status token. */
export function projectResourceSearchDocument(resource: Resource): SearchDocumentProjection {
  return {
    id: resource.id,
    title: resource.title,
    content: resource.content,  // Full content for search
    // Declared frontmatter status joins the index as its leading token
    // (BUG-0003) so generic resources obey the same --status semantics
    // as canonical entities. No declared status → never matches a filter.
    status: statusToken(resource.status) ?? '',
    type: 'resource',
    parent_id: '',
    evidence: '',
    blocked_reason: '',
    references: '',
    search_text: '',
    path: resource.path,
    updated_at: '',  // Resources don't have updated_at
  };
}

/** Resource embedding inputs match their searchable title and body. */
export function resourceEmbeddingText(resource: Resource): string {
  return `${resource.title} ${resource.content}`.trim();
}

