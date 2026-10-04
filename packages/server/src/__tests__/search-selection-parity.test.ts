/** Real Orama selection parity; persistence uses globally mocked memfs (ADR 0136). */
import { describe, expect, it } from 'vitest';
import { OramaSearchService, type SearchOptions } from '@backlog-mcp/memory/search';

async function fixture() {
  const service = new OramaSearchService({ cachePath: '/selection-parity/cache.json', hybridSearch: false });
  await service.index([
    { kind: 'entity-document', entity: { id: 'TASK-0001', title: 'Auth task', type: 'task', status: 'open' }, fields: [{ name: 'title', value: 'Auth task' }] },
    { kind: 'entity-document', entity: { id: 'REVIEW-0001', title: 'Auth review', type: 'custom-review', status: 'Open (maintainer)', parent_id: 'CONTEXT-1' }, fields: [{ name: 'title', value: 'Auth review' }] },
    { kind: 'entity-document', entity: { id: 'MEMO-0001', title: 'Auth memory', type: 'memory', status: 'open' }, fields: [{ name: 'title', value: 'Auth memory' }] },
  ]);
  await service.indexResources([{ id: 'mcp://backlog/notes/auth.md', path: 'notes/auth.md', title: 'Auth resource', content: 'Native auth', status: 'open' }]);
  service.configureIdIntent([{ strategy: 'prefixed-number', prefix: 'TASK', minimumDigits: 4 }, { strategy: 'prefixed-number', prefix: 'REVIEW', minimumDigits: 4 }, { strategy: 'prefixed-number', prefix: 'MEMO', minimumDigits: 4 }]);
  return service;
}

describe('selection parity across query routes', function parity() {
  it.each([
    { filters: { status: [] } },
    { filters: { status: [''] } },
    { docTypes: [] },
    { filters: { type: 'task', excludeTypes: ['task'] } },
  ] satisfies SearchOptions[])('empty/impossible selection returns no results in every route: %j', async function empty(options) {
    const service = await fixture();
    for (const query of ['TASK-0001', 'auth', 'open', 'mcp://backlog/notes/auth.md']) expect(await service.searchAll(query, options)).toEqual([]);
    expect(await service.search('TASK-0001', options)).toEqual([]);
    expect(await service.search('auth', options)).toEqual([]);
    service.flush();
  });
  it('caller custom types override inferred type and exclusions always intersect', async function typePrecedence() {
    const service = await fixture();
    const options: SearchOptions = { filters: { type: 'task', status: ['OPEN'], parent_id: 'CONTEXT-1' }, docTypes: ['custom-review'] };
    for (const query of ['REVIEW-0001', 'task auth', 'open']) expect((await service.searchAll(query, options)).map(function id(hit) { return hit.id; })).toEqual(['REVIEW-0001']);
    expect(await service.searchAll('auth', { ...options, filters: { ...options.filters, excludeTypes: ['custom-review'] } })).toEqual([]);
    service.flush();
  });
  it('exclusions without positive types are entity-only, while explicit resources remain selectable', async function resources() {
    const service = await fixture();
    const options = { filters: { excludeTypes: ['task'] } };
    for (const query of ['auth', 'open', 'mcp://backlog/notes/auth.md']) {
      const rows = await service.searchAll(query, options);
      expect(rows.every(function entity(hit) { return hit.type !== 'resource' && hit.type !== 'memory' && hit.type !== 'task'; })).toBe(true);
    }
    expect((await service.searchAll('REVIEW-0001', options))[0]?.type).toBe('custom-review');
    expect((await service.searchAll('auth', { ...options, docTypes: ['resource'] }))[0]?.type).toBe('resource');
    expect((await service.searchAll('mcp://backlog/notes/auth.md', { ...options, docTypes: ['resource'] }))[0]?.type).toBe('resource');
    expect(await service.search('auth', { filters: { type: 'resource' } })).toEqual([]);
    service.flush();
  });
  it('keeps direct memory navigation while generic queries exclude memory until selected', async function memoryNavigation() {
    const service = await fixture();
    expect((await service.searchAll('MEMO-0001'))[0]?.type).toBe('memory');
    expect((await service.searchAll('auth')).some(function memory(hit) { return hit.type === 'memory'; })).toBe(false);
    for (const query of ['auth', 'open']) expect((await service.searchAll(query, { docTypes: ['memory'] })).map(function id(hit) { return hit.id; })).toEqual(['MEMO-0001']);
    service.flush();
  });
});
