/** Read-side history invariants; external entity reads are injected (ADR 0136). */
import { describe, expect, it, vi } from 'vitest';
import type { AnyEntity } from '@backlog-mcp/shared';
import type { OperationEntry } from '../core/operation-log.contract.js';
import { createEntityReferenceReader } from '../core/entity-references.js';
import { enrichOperationHistory } from '../core/operation-history.js';
import { extractTargetFilename, normalizeOperationEntry } from '../core/operation-entry.js';

function operation(resourceId?: string, tool = 'backlog_update'): OperationEntry {
  return { resourceId, tool, ts: '2026-10-03T00:00:00.000Z', params: {}, result: { retained: true }, actor: { type: 'agent', name: 'test' } };
}
function entity(id: string, title: string, parent_id?: string): AnyEntity {
  return { id, title, type: 'custom-review', parent_id };
}

describe('operation history read projection', function historyProjection() {
  it('shares delayed target/parent lookups and preserves operation order', async function coalescesReferences() {
    let release: (value: AnyEntity | undefined) => void = function unused() {};
    const pending = new Promise<AnyEntity | undefined>(function defer(resolve) { release = resolve; });
    const get = vi.fn(function read(id: string) { return id === 'REVIEW-1' ? pending : Promise.resolve(entity('GROUP-1', 'Custom parent')); });
    const inputs = [operation('REVIEW-1'), operation('REVIEW-1', 'custom-intent'), operation('GROUP-1')];
    const reading = enrichOperationHistory({ get }, inputs);
    expect(get.mock.calls).toEqual([['REVIEW-1'], ['GROUP-1']]);
    release(entity('REVIEW-1', 'Custom review', 'GROUP-1'));
    expect(await reading).toEqual([
      { ...inputs[0], mutation: 'update', resourceTitle: 'Custom review', epicId: 'GROUP-1', epicTitle: 'Custom parent', targetFilename: undefined },
      { ...inputs[1], resourceTitle: 'Custom review', epicId: 'GROUP-1', epicTitle: 'Custom parent', targetFilename: undefined },
      { ...inputs[2], mutation: 'update', resourceTitle: 'Custom parent', epicId: undefined, epicTitle: undefined, targetFilename: undefined },
    ]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(inputs[0]?.mutation).toBeUndefined();
  });
  it('keeps caches local to each read/home, including missing references', async function isolatesCaches() {
    const first = vi.fn(async function read() { return undefined; });
    const second = vi.fn(async function read() { return entity('REVIEW-1', 'Other home'); });
    const entries = [operation('REVIEW-1'), operation('REVIEW-1')];
    expect((await enrichOperationHistory({ get: first }, entries))[0]?.resourceTitle).toBeUndefined();
    expect((await enrichOperationHistory({ get: second }, entries))[0]?.resourceTitle).toBe('Other home');
    await enrichOperationHistory({ get: second }, entries);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
  it('retains unknown historical tools and explicit mutation classifications', async function preservesHistory() {
    for (const tool of ['custom-intent', 'constructor', '__proto__', 'toString']) {
      const entry = operation(undefined, tool);
      expect(normalizeOperationEntry(entry)).toBe(entry);
    }
    const explicit = { ...operation(undefined, 'backlog_update'), mutation: 'create' as const };
    expect(normalizeOperationEntry(explicit)).toBe(explicit);
    expect(extractTargetFilename('resource-edit', { uri: 12, id: {} })).toBeUndefined();
    const get = vi.fn();
    const input = { ...operation(undefined, 'write_resource'), params: { uri: 'mcp://backlog/notes/native.md' } };
    expect(await enrichOperationHistory({ get }, [input])).toEqual([{ ...input, mutation: 'resource-edit', targetFilename: 'native.md' }]);
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['async', 'sync'])('coalesces %s reference failures without retrying inside the same read', async function failedCoalescing(mode) {
    const error = new Error('Selected reader failed');
    const reader = { get: vi.fn(function get(this: unknown) {
      expect(this).toBe(reader);
      if (mode === 'sync') throw error;
      return Promise.reject(error);
    }) };
    const reference = createEntityReferenceReader(reader);
    const first = reference('REVIEW-1');
    const repeated = reference('REVIEW-1');
    expect(first).toBe(repeated);
    await expect(first).rejects.toBe(error);
    await expect(repeated).rejects.toBe(error);
    expect(reader.get).toHaveBeenCalledOnce();
    await expect(createEntityReferenceReader(reader)('REVIEW-1')).rejects.toBe(error);
    expect(reader.get).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed authoritative reference read', async function propagatesReadFailure() {
    const error = new Error('selected home unavailable');
    await expect(enrichOperationHistory({ get: async function unavailable() { throw error; } }, [operation('REVIEW-1')])).rejects.toBe(error);
  });
});
