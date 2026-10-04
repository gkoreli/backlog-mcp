/** Pure search representations preserve declared fields and embedding reuse (ADR 0136). */
import { describe, expect, it } from 'vitest';
import { entityEmbeddingText, projectEntitySearchDocument, projectResourceSearchDocument, resourceEmbeddingText } from './search-document.js';

describe('search document projections', function projections() {
  it('flattens only declared fields and leaves custom authoritative data intact', function declaredProjection() {
    const entity = { id: 'REVIEW-1', type: 'custom-review', title: 'Raw title', status: 'Accepted (maintainer)', secret: 'Not declared', score: 42 };
    const fields = [{ name: 'title', value: 'Declared title' }, { name: 'rationale', value: ['Explain', { evidence: true }, 0, false] }];
    const before = structuredClone(entity);
    const projected = projectEntitySearchDocument({ entity, fields });
    expect(projected).toMatchObject({ title: 'Declared title', type: 'custom-review', status: 'accepted', content: '', search_text: 'Explain {"evidence":true} 0 false' });
    expect(JSON.stringify(projected)).not.toContain('Not declared');
    expect(entity).toEqual(before);
    expect(entityEmbeddingText({ entity, fields })).toBe('Declared title Explain {"evidence":true} 0 false');
  });
  it('separates payload, filter and embedding changes', function changeDomains() {
    const entity = { id: 'REVIEW-1', type: 'custom-review', title: 'Review', status: 'open', explanation: 'Payload' };
    const fields = [{ name: 'title', value: 'Review' }];
    const first = { entity, fields };
    const metadata = { entity: { ...entity, status: 'done' }, fields };
    const payload = { entity: { ...entity, explanation: 'Changed payload' }, fields };
    expect(projectEntitySearchDocument(metadata)).not.toEqual(projectEntitySearchDocument(first));
    expect(projectEntitySearchDocument(payload)).toEqual(projectEntitySearchDocument(first));
    expect(entityEmbeddingText(metadata)).toBe(entityEmbeddingText(first));
    expect(entityEmbeddingText(payload)).toBe(entityEmbeddingText(first));
    expect(entityEmbeddingText({ entity, fields: [{ name: 'title', value: 'Revised review' }] })).not.toBe(entityEmbeddingText(first));
  });
  it('preserves native resource status, path and title/body embedding inputs', function nativeResource() {
    const resource = { id: 'mcp://backlog/notes/review.md', path: 'notes/review.md', title: 'Review', content: 'Native body', status: 'Accepted, amended' };
    expect(projectResourceSearchDocument(resource)).toMatchObject({ type: 'resource', status: 'accepted', path: resource.path, title: 'Review', content: 'Native body' });
    expect(resourceEmbeddingText(resource)).toBe('Review Native body');
    expect(resource.status).toBe('Accepted, amended');
  });
});
