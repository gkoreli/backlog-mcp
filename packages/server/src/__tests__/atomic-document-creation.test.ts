import { mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import { createBacklogHome } from '../core/backlog-home.js';
import { createEntity } from '../core/create.js';
import { remember } from '../core/remember.js';
import { createLocalRuntime } from '../storage/local/local-runtime.js';
import { DocumentWriteBusyError, retryDocumentWrite, withDocumentWriteLock } from '../storage/local/document-write-lock.js';

function runtime(name: string) {
  const home = createBacklogHome({ kind: 'project', root: join(tmpdir(), 'atomic-creation', name) });
  return createLocalRuntime(home, {
    createSearch: function search(selected) {
      return new OramaSearchService({ cachePath: join(selected.controlDir, 'cache', 'search.json'), hybridSearch: false });
    },
  });
}

describe('atomic document creation', function atomicCreation() {
  it('creates concurrent memories through one repository without duplicate allocation', async function concurrentMemories() {
    const selected = runtime('concurrent-memories');
    const results = await Promise.all(Array.from({ length: 12 }, function write(_, index) {
      return remember({ title: `Memory ${index}`, content: `Durable fact ${index}` }, {
        memoryComposer: selected.memoryComposer,
        journal: { context: { actor: { type: 'agent', name: 'writer' }, operationLog: selected.operationLogger }, tool: 'backlog_remember' },
      });
    }));
    expect(new Set(results.map(function id(result) { return result.id; })).size).toBe(12);
    expect(await selected.service.list({ type: 'memory' })).toHaveLength(12);
    expect(await selected.operationLogger.query({ limit: 20 })).toHaveLength(12);
  });

  it('allocates from fresh disk claims across stale repositories, including custom substrates', async function staleRepositories() {
    const first = runtime('stale-repositories');
    const second = runtime('stale-repositories');
    expect(await first.service.getMaxId('requirement')).toBe(0);
    expect(await second.service.getMaxId('requirement')).toBe(0);
    const results = await Promise.all([first, second].map(function create(selected) {
      return createEntity(selected.service, {
        type: 'requirement', title: 'Constraint', content: 'Stay local',
        fields: { status: 'intake', compliance: 'unchecked' },
      }, { actor: { type: 'agent', name: 'writer' }, operationLog: selected.operationLogger }, {
        tool: 'backlog_capture_requirement', mutation: 'create',
      });
    }));
    expect(results.map(function id(result) { return result.id; })).toEqual(['REQ-0001', 'REQ-0002']);
    first.storage.invalidate();
    expect(await first.service.list({ type: 'requirement' })).toHaveLength(2);
  });

  it('skips an externally created identity even before watcher reconciliation', async function externalIdentity() {
    const selected = runtime('external-identity');
    expect(await selected.service.getMaxId('memory')).toBe(0);
    mkdirSync(join(selected.home.documentsDir, 'memories'), { recursive: true });
    const path = join(selected.home.documentsDir, 'memories', 'MEMO-0017-external.md');
    const bytes = '---\ntitle: [\n---\nMalformed but occupied';
    writeFileSync(path, bytes);
    const result = await remember({ title: 'Next memory', content: 'Survives external writes' }, { memoryComposer: selected.memoryComposer });
    expect(result.id).toBe('MEMO-0018');
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  });

  it('releases the lock after a failed validation without consuming an ID', async function releasesFailedWrite() {
    const selected = runtime('invalid-write');
    await expect(selected.service.create({ type: 'requirement', title: 'Invalid' })).rejects.toThrow();
    const entity = await selected.service.create({ type: 'requirement', title: 'Valid', content: 'Constraint', status: 'intake', compliance: 'unchecked' });
    expect(entity.id).toBe('REQ-0001');
  });

  it('refuses a competing writer and leaves the held lock intact', function excludesWriter() {
    const selected = runtime('held-lock');
    const path = join(selected.home.controlDir, 'state', 'document-write.lock');
    withDocumentWriteLock(selected.home, function owner() {
      expect(function contender() {
        selected.storage.create({ type: 'task', title: 'Contender' });
      }).toThrow(DocumentWriteBusyError);
      expect(existsSync(path)).toBe(true);
    });
    expect(existsSync(path)).toBe(false);
    expect(selected.storage.create({
      type: 'requirement', title: 'After release', content: 'Constraint',
      status: 'intake', compliance: 'unchecked',
    }).id).toBe('REQ-0001');
  });

  it('does not remove a pre-existing lock or follow a state-directory symlink', function rejectsUnsafePaths() {
    const selected = runtime('unsafe-lock');
    const outside = join(tmpdir(), 'atomic-creation', 'outside');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(selected.home.controlDir, 'state'));
    expect(function escapesHome() { selected.storage.create({ type: 'task', title: 'Unsafe' }); }).toThrow(/Unsafe document write lock/);
    expect(existsSync(join(outside, 'document-write.lock'))).toBe(false);
    const held = runtime('abandoned-lock');
    mkdirSync(join(held.home.controlDir, 'state'), { recursive: true });
    const path = join(held.home.controlDir, 'state', 'document-write.lock');
    writeFileSync(path, 'owner');
    expect(function stealLock() { held.storage.create({ type: 'task', title: 'Unsafe' }); }).toThrow(DocumentWriteBusyError);
    expect(readFileSync(path, 'utf8')).toBe('owner');
  });

  it('bounds retries and never retries a write failure', async function retriesContentionOnly() {
    vi.useFakeTimers();
    try {
      const busy = vi.fn(function contend() { throw new DocumentWriteBusyError('/home/lock'); });
      const result = expect(retryDocumentWrite(busy)).rejects.toThrow(DocumentWriteBusyError);
      await vi.runAllTimersAsync();
      await result;
      expect(busy).toHaveBeenCalledTimes(101);
      const failed = vi.fn(function failure() { throw new Error('write failed'); });
      await expect(retryDocumentWrite(failed)).rejects.toThrow('write failed');
      expect(failed).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
