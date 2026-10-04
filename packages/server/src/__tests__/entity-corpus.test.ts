/** Complete reads and eligibility are repository contracts, not mock assumptions. */
import { describe, expect, it } from 'vitest';
import type { Memory } from '@backlog-mcp/shared';
import { localHome } from './helpers/local-home.js';
import { buildEntity } from '../storage/entity-factory.js';
import { BacklogMemoryStore } from '../memory/backlog-memory-store.js';
import { listItems } from '../core/list.js';
import { detectContradictions } from '../core/contradictions.js';
import { wakeup } from '../core/wakeup.js';
import { readEntityCorpus, CorpusReadUnavailableError } from '../core/entity-corpus.js';

function memoryCorpus(name: string) {
  const runtime = localHome(name);
  for (let index = 1; index <= 25; index++) {
    runtime.storage.add({ ...buildEntity({
      id: `MEMO-${String(index).padStart(4, '0')}`, type: 'memory',
      title: `Memory ${index}`, content: 'Corpus needle', layer: 'semantic',
      ...(index <= 2 ? { state_key: 'database.primary' } : {}),
    }), created_at: `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z`, updated_at: `2026-01-${String(index).padStart(2, '0')}T00:00:00.000Z` });
  }
  return { ...runtime, store: new BacklogMemoryStore(function getService() { return runtime.service; }) };
}

describe('complete entity corpus', function describeCompleteCorpus() {
  it('keeps the default page bounded but reads and counts every memory', async function countsWholeCorpus() {
    const { service, store } = memoryCorpus('complete-count');
    expect(await service.list({ type: 'memory' })).toHaveLength(20);
    expect(await service.scan({ type: 'memory' })).toHaveLength(25);
    expect(service.scanSync({ type: 'memory' })).toHaveLength(25);
    expect(await store.size()).toBe(25);
    expect((await detectContradictions(service)).groups).toHaveLength(1);
  });

  it('forgets an explicitly named older memory beyond the display page', async function forgetsOlderId() {
    const { service, store } = memoryCorpus('complete-forget');
    expect(await store.forget({ ids: ['MEMO-0001'] })).toBe(1);
    expect((await service.get('MEMO-0001') as Memory).valid_until).toBeTruthy();
    expect(await store.size()).toBe(24);
  });

  it('closes every older state-key holder, retaining history', async function correctsOlderHolders() {
    const { service, store } = memoryCorpus('complete-correction');
    await store.store({ id: 'pending', title: 'Replacement', content: 'Current fact', layer: 'semantic', createdAt: Date.now(), metadata: { state_key: 'database.primary' } });
    expect((await service.get('MEMO-0001') as Memory).valid_until).toBeTruthy();
    expect((await service.get('MEMO-0002') as Memory).valid_until).toBeTruthy();
    expect(await store.size()).toBe(24);
    expect(await service.scan({ type: 'memory' })).toHaveLength(26);
  });

  it('selects visible work before limiting both browse and query lists', async function listsEligibleWork() {
    const { storage, service } = memoryCorpus('eligible-page');
    storage.add({ ...buildEntity({ id: 'TASK-0001', title: 'Corpus needle work' }), updated_at: '2025-01-01T00:00:00.000Z' });
    expect((await service.list()).every(function isMemory(entity) { return entity.type === 'memory'; })).toBe(true);
    expect((await listItems(service)).tasks.map(function id(item) { return item.id; })).toEqual(['TASK-0001']);
    expect((await listItems(service, { query: 'corpus', limit: 1 })).tasks[0]?.id).toBe('TASK-0001');
    expect((await listItems(service, { type: 'memory' })).tasks).toHaveLength(20);
    for (const query of [undefined, 'corpus']) {
      expect(await service.list({ query, type: 'memory', excludeTypes: ['memory'] })).toEqual([]);
      expect(await service.list({ query, type: 'task', excludeTypes: ['memory'] })).toHaveLength(1);
    }
    expect(await service.searchUnified('corpus', { types: ['task'] })).toHaveLength(1);
  });

  it('scopes through more than twenty children before choosing completions', async function traversesWholeSubtree() {
    const { service, storage } = localHome('whole-subtree');
    storage.add(buildEntity({ id: 'FLDR-0001', type: 'folder', title: 'Scope' }));
    for (let index = 1; index <= 25; index++) {
      storage.add(buildEntity({ id: `TASK-${String(index).padStart(4, '0')}`, title: `Child ${index}`, status: 'done', parent_id: 'FLDR-0001' }));
    }
    const result = await wakeup(service, { context: 'FLDR-0001', maxCompletions: 30, maxKnowledge: 0 });
    expect(result.recent.completions).toHaveLength(25);
  });

  it('rejects an unavailable complete-read capability rather than analyzing a page', async function rejectsBoundedFallback() {
    await expect(readEntityCorpus({})).rejects.toBeInstanceOf(CorpusReadUnavailableError);
  });
});
