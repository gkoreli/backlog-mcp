/** HTTP search projection and safe client highlighting (ADR 0135 R5). */
import { Highlight } from '@orama/highlight';
import type { HomeProvenance } from '../utils/api.js';

export interface SearchEntity extends Partial<HomeProvenance> {
  id: string;
  title: string;
  type?: string;
  status?: string;
  content?: string;
  updated_at?: string;
}

export interface SearchResource extends Partial<HomeProvenance> {
  id: string;
  title: string;
  path: string;
  content: string;
}

/** Plain-text snippet supplied by the server's declared field projection. */
export interface SearchSnippet {
  field: string;
  text: string;
  matched_fields: string[];
}

export interface UnifiedSearchResult extends Partial<HomeProvenance> {
  item: SearchEntity | SearchResource;
  type: string;
  score: number;
  snippet?: SearchSnippet;
}

/** Escape source fragments before inserting the client's own markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, function escape(character) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character;
  });
}

/** Use highlighter positions, never its unescaped HTML output. */
export function highlightSearchText(text: string, query: string): string {
  if (!query.trim()) return escapeHtml(text);
  const positions = new Highlight().highlight(text, query).positions;
  let end = 0;
  const parts: string[] = [];
  for (const position of positions) {
    parts.push(escapeHtml(text.slice(end, position.start)));
    parts.push(`<mark class="spotlight-match">${escapeHtml(text.slice(position.start, position.end + 1))}</mark>`);
    end = position.end + 1;
  }
  parts.push(escapeHtml(text.slice(end)));
  return parts.join('');
}

/** Preserve the server match explanation; older servers get a title fallback. */
export function presentSearchSnippet(result: UnifiedSearchResult, query: string) {
  return {
    field: result.snippet?.field ?? 'title',
    html: highlightSearchText(result.snippet?.text ?? result.item.title, query),
    matchedFields: result.snippet?.matched_fields ?? [],
  };
}
