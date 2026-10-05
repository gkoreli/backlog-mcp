import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { OramaSearchService, SearchIndexBuildSupersededError, EmbeddingService, EMBEDDING_DIMENSIONS, type SearchEntityDocument } from '@backlog-mcp/memory/search';

function document(id: string, title: string): SearchEntityDocument {
  return { kind: 'entity-document', entity: { id, title, type: 'note', status: 'open', custom: { retained: true } }, fields: [{ name: 'title', value: title }] };
}
function service(name: string, hybridSearch = false) { return new OramaSearchService({ cachePath: `/${name}/index.json`, hybridSearch }); }
function gate() {
  let release: () => void = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  return { waiting, release };
}
const vector = Array(EMBEDDING_DIMENSIONS).fill(0.1);
afterEach(function restore() { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('search active state and cache lifetime', function lifecycle() {
  it('retains resources in the database and payloads across a fresh entity rebuild', async function resources() {
    const search = service('retained-resources');
    await search.index([document('NOTE-1', 'Old needle')]);
    await search.addResource({ id: 'REF-1', title: 'Resource needle', path: 'docs/needle.md', content: 'resource body', status: 'open' });
    fs.unlinkSync('/retained-resources/index.json');
    await search.index([document('NOTE-2', 'New needle')]);
    expect((await search.searchResources('needle')).map(h => h.id)).toEqual(['REF-1']);
    expect((await search.searchAll('open', { docTypes: ['resource'] })).map(h => h.id)).toEqual(['REF-1']);
    expect((await search.searchAll('needle')).map(h => h.id).sort()).toEqual(['NOTE-2', 'REF-1']);
    search.flush();
  });

  it.each(['payload', 'fields', 'count', 'internal', 'embedding-flag', 'json'])('repairs inconsistent %s cache from authoritative documents', async function cacheMiss(kind) {
    const name = `broken-${kind}`;
    const first = service(name);
    await first.index([document('NOTE-1', 'Old needle')]);
    const path = `/${name}/index.json`;
    const snapshot = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (kind === 'payload') snapshot.tasks['NOTE-1'].status = 'done';
    if (kind === 'fields') snapshot.entityFields['NOTE-1'][0].value = 'Different projection';
    if (kind === 'count') snapshot.tasks = {};
    if (kind === 'embedding-flag') snapshot.hasEmbeddings = true;
    if (kind === 'internal') snapshot.index.docs = null;
    fs.writeFileSync(path, kind === 'json' ? '{' : JSON.stringify(snapshot));
    const reloaded = service(name);
    await reloaded.index([document('NOTE-2', 'Replacement needle')]);
    expect((await reloaded.searchAll('needle')).map(h => h.id)).toEqual(['NOTE-2']);
    reloaded.flush();
  });

  it('loads custom and prototype-shaped IDs without closing the vocabulary', async function customCache() {
    const first = service('open-vocabulary');
    await first.index([document('__proto__', 'Needle custom')]);
    const reloaded = service('open-vocabulary');
    await reloaded.index([]);
    expect((await reloaded.searchAll('needle'))[0]?.item).toMatchObject({ id: '__proto__', custom: { retained: true } });
    reloaded.flush();
  });

  it.each(['writeFileSync', 'renameSync'] as const)('retains prior complete cache on %s failure and flush cancels debounce', async function cacheFailure(method) {
    vi.useFakeTimers();
    const name = `failed-${method}`;
    const search = service(name);
    await search.index([document('NOTE-1', 'Needle old')]);
    const path = `/${name}/index.json`;
    const previous = fs.readFileSync(path, 'utf8');
    await search.updateDocument(document('NOTE-1', 'Needle new'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = vi.spyOn(fs, method).mockImplementation(function fail() { throw new Error('cache publication failed'); });
    search.flush();
    expect(fs.readFileSync(path, 'utf8')).toBe(previous);
    expect(fs.readdirSync(`/${name}`)).toEqual(['index.json']);
    expect(vi.getTimerCount()).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    failure.mockRestore();
    search.flush();
    const reloaded = service(name);
    await reloaded.index([]);
    expect((await reloaded.searchAll('needle'))[0]?.item.title).toBe('Needle new');
  });

  it('keeps old state on partial build failure, and binds a pending query to the old index', async function staged() {
    vi.spyOn(EmbeddingService.prototype, 'init').mockResolvedValue(undefined);
    const embed = vi.spyOn(EmbeddingService.prototype, 'embed').mockResolvedValue(vector);
    const search = service('staged-index', true);
    await search.index([document('NOTE-1', 'Needle old')]);
    fs.unlinkSync('/staged-index/index.json');
    embed.mockResolvedValueOnce(vector).mockRejectedValueOnce(new Error('embedding failed'));
    await expect(search.index([document('NOTE-2', 'Candidate needle'), document('NOTE-3', 'Fails needle')])).rejects.toThrow('embedding failed');
    expect((await search.searchAll('needle')).map(h => h.id)).toEqual(['NOTE-1']);
    const pending = gate();
    embed.mockImplementationOnce(async function queryVector() { await pending.waiting; return vector; });
    const query = search.searchAll('needle');
    await search.index([document('NOTE-2', 'Needle new')]);
    pending.release();
    const hits = await query;
    expect(hits.map(h => h.id)).toEqual(['NOTE-1']);
    expect(hits[0]?.item.title).toBe('Needle old');
    expect((await search.searchAll('needle'))[0]?.item.title).toBe('Needle new');
    search.flush();
  });

  it('rejects builds crossing mutations in both admission orders', async function concurrentMutation() {
    vi.spyOn(EmbeddingService.prototype, 'init').mockResolvedValue(undefined);
    const embed = vi.spyOn(EmbeddingService.prototype, 'embed').mockResolvedValue(vector);
    const search = service('mutation-guard', true);
    await search.index([document('NOTE-1', 'Needle old')]);
    fs.unlinkSync('/mutation-guard/index.json');
    const building = gate(); const entered = gate();
    embed.mockImplementationOnce(async function blockedBuild() { entered.release(); await building.waiting; return vector; });
    const candidate = search.index([document('NOTE-2', 'Candidate needle')]);
    const rejection = expect(candidate).rejects.toBeInstanceOf(SearchIndexBuildSupersededError);
    await entered.waiting;
    await search.addDocument(document('NOTE-3', 'Mutation needle'));
    building.release();
    await rejection;
    const mutation = gate(); const mutationEntered = gate();
    embed.mockImplementationOnce(async function blockedMutation() { mutationEntered.release(); await mutation.waiting; return vector; });
    const adding = search.addDocument(document('NOTE-4', 'Delayed needle'));
    await mutationEntered.waiting;
    await expect(search.index([document('NOTE-5', 'Would replace needle')])).rejects.toBeInstanceOf(SearchIndexBuildSupersededError);
    mutation.release(); await adding;
    expect((await search.searchAll('needle')).map(h => h.id).sort()).toEqual(['NOTE-1', 'NOTE-3', 'NOTE-4']);
    search.flush();
  });

  it('rejects a delayed build after another build publishes', async function overlappingBuilds() {
    vi.spyOn(EmbeddingService.prototype, 'init').mockResolvedValue(undefined);
    const embed = vi.spyOn(EmbeddingService.prototype, 'embed').mockResolvedValue(vector);
    const search = service('build-guard', true);
    await search.index([document('NOTE-1', 'Needle old')]);
    fs.unlinkSync('/build-guard/index.json');
    const pending = gate(); const entered = gate();
    embed.mockImplementationOnce(async function blocked() { entered.release(); await pending.waiting; return vector; });
    const first = search.index([document('NOTE-2', 'Needle delayed')]);
    const rejection = expect(first).rejects.toBeInstanceOf(SearchIndexBuildSupersededError);
    await entered.waiting;
    await search.index([document('NOTE-3', 'Needle published')]);
    pending.release(); await rejection;
    expect((await search.searchAll('needle')).map(h => h.id)).toEqual(['NOTE-3']);
    search.flush();
  });
});

describe('query observation time', function queryTime() {
  it('keeps decay anchored before a delayed vector retriever crosses a day boundary', async function delayedDecay() {
    const now = Date.parse('2026-10-05T00:00:00Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(EmbeddingService.prototype, 'init').mockResolvedValue(undefined);
    const embed = vi.spyOn(EmbeddingService.prototype, 'embed').mockResolvedValue(vector);
    const search = new OramaSearchService({ cachePath: '/query-clock/index.json', hybridSearch: true, halfLifeDays: 1 });
    const candidate = document('NOTE-1', 'Needle convention');
    candidate.entity.created_at = new Date(now - 86400000).toISOString();
    await search.index([candidate]);
    const baseline = await search.searchAll('needle');
    expect(baseline).toHaveLength(1);
    const pending = gate();
    embed.mockImplementationOnce(async function delayedVector() { await pending.waiting; return vector; });
    const result = search.searchAll('needle');
    clock.mockReturnValue(now + 30 * 86400000);
    pending.release();
    expect(await result).toEqual(baseline);
  });
});
