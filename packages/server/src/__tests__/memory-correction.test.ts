import { MemoryUsageTracker } from '../memory/usage-tracker.js';
import { EntityWriteConflictError } from '../core/entity-mutation.contract.js';
/** Complete correction plans, atomic publication and guarded recovery over memfs. */
import * as fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MemoryComposer, type MemoryEntry } from '@backlog-mcp/memory';
import { MemorySchema, type Memory } from '@backlog-mcp/shared';
import { localHome } from './helpers/local-home.js';
import { buildEntity } from '../storage/entity-factory.js';
import { BacklogMemoryStore } from '../memory/backlog-memory-store.js';
import { MemoryCorrectionError } from '../core/memory-correction.contract.js';
import { isMemoryLive, memoryValidity } from '../core/memory-validity.js';
import { remember } from '../core/remember.js';
import { mintMemoryEntry } from '../core/memory-entry.js';
import { groupByStateKey } from '../core/contradictions.js';

const NOW = Date.parse('2026-10-03T12:00:00Z');
function entry(title: string): MemoryEntry {
  return { id: 'transient', title, content: 'New fact', source: 'test', layer: 'semantic', createdAt: NOW, metadata: { state_key: 'build.bundler' } };
}
function fixture(name: string, count = 1) {
  const graph = localHome(name);
  for (let n = 1; n <= count; n++) graph.storage.add(buildEntity({ id: `MEMO-${String(n).padStart(4, '0')}`, type: 'memory', title: `Previous ${n}`, content: `Historical body ${n}`, state_key: 'build.bundler' }));
  return { ...graph, store: new BacklogMemoryStore(() => graph.service, undefined, () => NOW) };
}

describe('memory correction consistency', function corrections() {
  it('discovers all holders inside the home lock across two independent local repositories', async function serializesCorrection() {
    const first = fixture('two-memory-repositories', 25);
    const second = localHome('two-memory-repositories');
    const secondStore = new BacklogMemoryStore(() => second.service, undefined, () => NOW);
    const receipts = await Promise.all([first.store.store(entry('First correction')), secondStore.store(entry('Second correction'))]);
    expect(new Set(receipts.map(function id(receipt) { return receipt.id; })).size).toBe(2);
    first.storage.invalidate();
    const corpus = await first.service.scan({ type: 'memory' });
    expect(corpus).toHaveLength(27);
    expect(corpus.filter(function live(memory) { return isMemoryLive(memory as Memory, NOW); })).toHaveLength(1);
    expect(corpus.find(function old(memory) { return memory.id === 'MEMO-0001'; })?.content).toBe('Historical body 1');
  });

  it('validates successor and predecessor adoption before any document mutation', async function prevalidatesCorrection() {
    const { storage, service } = fixture('prevalidate-correction');
    const before = storage.getMarkdown('MEMO-0001');
    const { id: _id, ...draft } = MemorySchema.parse(storage.get('MEMO-0001'));
    await expect(service.correctMemory({ ...draft, title: '' }, NOW)).rejects.toThrow();
    expect(storage.getMarkdown('MEMO-0001')).toBe(before);
    const path = storage.getFilePath('MEMO-0001');
    if (path === null || before === null) throw new Error('Fixture absent');
    fs.writeFileSync(path, before.replace('---\n', '---\n# Native formatting\n'));
    await expect(service.correctMemory(draft, NOW)).rejects.toThrow('Canonical adoption');
    expect(fs.readFileSync(path, 'utf8')).toContain('# Native formatting');
    expect(await service.scan({ type: 'memory' })).toHaveLength(1);
  });

  it('restores exact predecessors when exclusive successor publication fails', async function recoversSuccessorFailure() {
    const { storage, store, service } = fixture('failed-successor', 2);
    const originals = ['MEMO-0001', 'MEMO-0002'].map(function bytes(id) { return storage.getMarkdown(id); });
    const link = vi.spyOn(fs, 'linkSync').mockImplementationOnce(function failPublication() { throw new Error('disk full'); });
    await expect(store.store(entry('Successor'))).rejects.toMatchObject({ outcome: 'rolled_back', unrecoveredIds: [], affectedIds: ['MEMO-0001', 'MEMO-0002', 'MEMO-0003'] });
    link.mockRestore();
    expect(['MEMO-0001', 'MEMO-0002'].map(function bytes(id) { return storage.getMarkdown(id); })).toEqual(originals);
    expect(await service.scan({ type: 'memory' })).toHaveLength(2);
    expect(fs.readdirSync(`${storage.getFilePath('MEMO-0001')?.split('/').slice(0, -1).join('/')}`)).toHaveLength(2);
  });

  it('restores earlier closures when a later predecessor publication fails', async function recoversClosureFailure() {
    const { storage, store } = fixture('failed-closure', 2);
    const before = storage.getMarkdown('MEMO-0001');
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(function failSecond(source, target) {
      if (String(target) === storage.getFilePath('MEMO-0002')) throw new Error('permission denied');
      rename(source, target);
    });
    await expect(store.store(entry('Successor'))).rejects.toBeInstanceOf(MemoryCorrectionError);
    spy.mockRestore();
    expect(storage.getMarkdown('MEMO-0001')).toBe(before);
    expect(await store.size()).toBe(2);
  });

  it('preserves a native edit during recovery and reports partial failure IDs', async function guardsRecovery() {
    const { storage, store } = fixture('native-correction-recovery');
    const path = storage.getFilePath('MEMO-0001');
    if (path === null) throw new Error('Fixture absent');
    const link = vi.spyOn(fs, 'linkSync').mockImplementationOnce(function nativeEditThenFailure() {
      fs.writeFileSync(path, fs.readFileSync(path, 'utf8') + '\nNative edit during correction\n');
      throw new Error('exclusive publication failed');
    });
    await expect(store.store(entry('Successor'))).rejects.toMatchObject({ outcome: 'partial_failure', unrecoveredIds: ['MEMO-0001'], affectedIds: ['MEMO-0001', 'MEMO-0002'] });
    link.mockRestore();
    expect(fs.readFileSync(path, 'utf8')).toContain('Native edit during correction');
    expect(storage.get('MEMO-0002')).toBeUndefined();
  });

  it('propagates committed indexing and journal diagnostics through composer and remember', async function acknowledgesRemember() {
    const { service, store, search } = fixture('remember-diagnostics');
    const composer = new MemoryComposer();
    composer.register('semantic', store);
    vi.spyOn(search, 'updateDocument').mockRejectedValueOnce(new Error('index offline'));
    const append = vi.fn(function failLog() { throw new Error('journal offline'); });
    const receipt = await remember({ title: 'Replacement', content: 'New fact', state_key: 'build.bundler' }, {
      memoryComposer: composer, now: () => NOW,
      journal: { tool: 'backlog_remember', context: { actor: { type: 'user', name: 'test' }, operationLog: { append, query: async function query() { return []; }, countForTask: async function count() { return 0; } } } },
    });
    expect(receipt.warnings?.map(function code(warning) { return warning.code; })).toEqual(['index_repair_pending', 'journal_append_failed']);
    expect(append).toHaveBeenCalledTimes(1);
    expect((await service.get(receipt.id))?.title).toBe('Replacement');
    expect(await store.size()).toBe(1);
    expect((await service.searchUnified('Replacement', { types: ['memory'] }))[0]?.item.id).toBe(receipt.id);
    expect(await service.getMarkdown(receipt.id)).not.toContain('writeWarnings');
    service.flush();
  });

  it('keeps original bytes and file permissions after a failed atomic update', async function atomicSave() {
    const { storage, service } = fixture('atomic-markdown-save');
    const path = storage.getFilePath('MEMO-0001');
    const original = storage.get('MEMO-0001');
    if (path === null || original === undefined) throw new Error('Fixture absent');
    fs.chmodSync(path, 0o664);
    const bytes = fs.readFileSync(path, 'utf8');
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(function failRename() { throw new Error('rename unavailable'); });
    await expect(service.save({ ...original, title: 'Failed title' })).rejects.toThrow('rename unavailable');
    rename.mockRestore();
    expect(fs.readFileSync(path, 'utf8')).toBe(bytes);
    await service.save({ ...original, title: 'Successful title' });
    expect(fs.statSync(path).mode & 0o777).toBe(0o664);
  });

  it('rejects stale soft forgetting and drops stale usage updates without overwriting native changes', async function guardsMemoryWriters() {
    for (const mode of ['forget', 'usage']) {
      const { service, storage, store } = fixture(`guarded-memory-${mode}`);
      const path = storage.getFilePath('MEMO-0001');
      if (path === null) throw new Error('Fixture absent');
      const originalSave = service.saveCommitted.bind(service);
      const save = vi.spyOn(service, 'saveCommitted').mockImplementationOnce(async function nativeBeforeSave(candidate, options) {
        fs.writeFileSync(path, fs.readFileSync(path, 'utf8').replace('Historical body 1', 'Native corrected body'));
        return originalSave(candidate, options);
      });
      if (mode === 'forget') {
        await expect(store.forget({ ids: ['MEMO-0001'] })).rejects.toBeInstanceOf(EntityWriteConflictError);
      } else {
        const appendLine = vi.fn();
        const tracker = new MemoryUsageTracker({ getService: () => service, now: () => NOW, appendLine });
        await expect(tracker.recordExpand('MEMO-0001')).resolves.toBeUndefined();
        expect(appendLine).toHaveBeenCalledTimes(1);
      }
      expect(save).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(path, 'utf8')).toContain('Native corrected body');
      expect((await service.get('MEMO-0001'))?.valid_until).toBeUndefined();
      expect((await service.get('MEMO-0001'))?.usage_count).toBeUndefined();
    }
  });

  it('rejects GC deletion when an expired memory is natively revived after selection', async function guardsMemoryGc() {
    const { service, storage, store } = fixture('guarded-memory-gc');
    const memory = MemorySchema.parse(storage.get('MEMO-0001'));
    await service.save({ ...memory, valid_until: new Date(NOW - 1).toISOString() });
    const path = storage.getFilePath(memory.id);
    if (path === null) throw new Error('Fixture absent');
    const originalDelete = service.deleteCommitted.bind(service);
    vi.spyOn(service, 'deleteCommitted').mockImplementationOnce(async function nativeBeforeDelete(id, options) {
      fs.writeFileSync(path, fs.readFileSync(path, 'utf8').replace(new Date(NOW - 1).toISOString(), new Date(NOW + 10000).toISOString()));
      return originalDelete(id, options);
    });
    await expect(store.forget({ expired: true })).rejects.toBeInstanceOf(EntityWriteConflictError);
    expect(fs.existsSync(path)).toBe(true);
    expect(await store.size()).toBe(1);
  });

  it('fails visibly when a correction capability is absent', async function noUnsafeFallback() {
    const { service } = fixture('missing-correction-capability');
    const store = new BacklogMemoryStore(() => ({ ...service, correctMemory: undefined }) as typeof service);
    await expect(store.store(entry('Successor'))).rejects.toThrow('home-coordinated');
  });
});

describe('memory validity policy', function validityPolicy() {
  it.each([undefined, null, '', 'invalid', new Date(NOW - 1).toISOString(), new Date(NOW).toISOString(), new Date(NOW + 1).toISOString()])('projects expiry %s consistently for counts, recall and contradictions', async function validity(value) {
    const graph = fixture(`validity-${String(value)}`);
    const memory = MemorySchema.parse({ ...graph.storage.get('MEMO-0001'), ...(value === undefined ? {} : { valid_until: value }) });
    // Null is a lossless native value, not a write-schema promise.
    const path = graph.storage.getFilePath(memory.id);
    if (path === null) throw new Error('Fixture absent');
    await graph.service.save(memory);
    const expected = memoryValidity(value, NOW).state !== 'expired';
    expect(await graph.store.size()).toBe(expected ? 1 : 0);
    expect(await graph.store.recall({ query: 'Historical' })).toHaveLength(expected ? 1 : 0);
    const second = { ...memory, id: 'MEMO-0002' };
    expect(groupByStateKey([memory, second], { now: NOW })).toHaveLength(expected ? 1 : 0);
    expect(Number.isNaN(mintMemoryEntry(memory, undefined, NOW).expiresAt)).toBe(false);
    expect(mintMemoryEntry(memory, undefined, NOW).metadata?.invalid_valid_until).toBe(value === 'invalid' ? value : undefined);
    graph.service.flush();
  });
});
