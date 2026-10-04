/** Authoritative payload/filter freshness is independent of embedding text. */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { OramaSearchService, EmbeddingService, EMBEDDING_DIMENSIONS, type SearchEntityDocument } from '@backlog-mcp/memory/search';
import { localHome } from './helpers/local-home.js';
import { buildEntity } from '../storage/entity-factory.js';

describe('search payload freshness', function describeFreshness() {
  it('refreshes filters and unprojected custom payload without recomputing embeddings', async function refreshesMetadata() {
    const init = vi.spyOn(EmbeddingService.prototype, 'init').mockResolvedValue(undefined);
    const embed = vi.spyOn(EmbeddingService.prototype, 'embed').mockResolvedValue(Array(EMBEDDING_DIMENSIONS).fill(0.1));
    const cachePath = '/fresh-search/cache.json';
    const search = new OramaSearchService({ cachePath, hybridSearch: true });
    const document: SearchEntityDocument = { kind: 'entity-document', entity: { id: 'NOTE-0001', type: 'note', title: 'Needle note', status: 'proposed', parent_id: 'FLDR-0001', reviewer: 'old' }, fields: [{ name: 'title', value: 'Needle note' }] };
    try {
      await search.index([document]);
      const changed: SearchEntityDocument = { ...document, entity: { ...document.entity, status: 'accepted', parent_id: 'FLDR-0002', reviewer: 'new' } };
      expect(await search.reconcile([changed])).toEqual({ added: 0, removed: 0, updated: 1 });
      expect(embed).toHaveBeenCalledTimes(1);
      expect(await search.searchAll('needle', { filters: { status: ['proposed'] } })).toEqual([]);
      expect((await search.searchAll('needle', { filters: { parent_id: 'FLDR-0002' } }))[0]?.item).toMatchObject({ reviewer: 'new', status: 'accepted' });
      const payloadOnly = { ...changed, entity: { ...changed.entity, reviewer: 'newest' } };
      const before = embed.mock.calls.length;
      await search.reconcile([payloadOnly]);
      expect(embed).toHaveBeenCalledTimes(before);
      search.flush();
      const reloaded = new OramaSearchService({ cachePath, hybridSearch: true });
      await reloaded.index([payloadOnly]);
      expect((await reloaded.searchAll('needle'))[0]?.item).toMatchObject({ reviewer: 'newest' });
      reloaded.flush();
    } finally {
      search.flush();
      init.mockRestore();
      embed.mockRestore();
    }
  });

  it('reconciles a native status edit without advancing its timestamp', async function refreshesNativeEdit() {
    const { service, storage } = localHome('native-filter-freshness');
    storage.add({ ...buildEntity({ id: 'TASK-0001', title: 'Needle work', status: 'open' }), updated_at: '2026-01-01T00:00:00.000Z' });
    await service.reconcile();
    const file = storage.getFilePath('TASK-0001');
    if (file === null) throw new Error('Missing fixture');
    writeFileSync(file, readFileSync(file, 'utf8').replace('status: open', 'status: done'));
    await service.reconcile();
    expect(await service.searchUnified('needle', { status: ['open'] })).toEqual([]);
    expect(await service.searchUnified('TASK-0001', { status: ['open'] })).toEqual([]);
    expect((await service.searchUnified('TASK-0001', { status: ['done'] }))[0]?.item.status).toBe('done');
    expect((await service.searchUnified('needle', { status: ['done'] }))[0]?.item).toMatchObject({ status: 'done', updated_at: '2026-01-01T00:00:00.000Z' });
    service.flush();
  });
});
