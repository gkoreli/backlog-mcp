/** Real memfs write boundaries: conflicts, commit outcomes and open body edits. */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { localHome } from './helpers/local-home.js';
import { buildEntity } from '../storage/entity-factory.js';
import { updateEntity, updateEntityPostimage } from '../core/update.js';
import { createEntity } from '../core/create.js';
import { deleteItem } from '../core/delete.js';
import { editItem } from '../core/edit.js';
import { EntityWriteConflictError } from '../core/entity-mutation.contract.js';
import type { WriteContext } from '../core/types.js';
import { BacklogService } from '../storage/local/backlog-service.js';
import type { DiscoveredSubstrateDeclaration } from '../core/document-discovery.types.js';

const UPDATE = { tool: 'backlog update', mutation: 'update' } as const;
const EDIT = { tool: 'backlog edit', mutation: 'resource-edit' } as const;
const CREATE = { tool: 'backlog create', mutation: 'create' } as const;

function journal() {
  const append = vi.fn();
  const emit = vi.fn();
  const context: WriteContext = { actor: { type: 'user', name: 'test' }, operationLog: { append, query: async function query() { return []; }, countForTask: async function count() { return 0; } }, eventBus: { emit } };
  return { context, append, emit };
}

function noteDefinition(): DiscoveredSubstrateDeclaration {
  return { sourcePath: 'substrates/note.json', absolutePath: '/fixture/substrates/note.json', value: {
    definitionVersion: 1, type: 'note', label: { singular: 'Note', plural: 'Notes' }, folder: 'notes',
    identity: { strategy: 'numbered', minimumDigits: 4, displayTemplate: 'NOTE {key}' },
    schema: { type: 'object', properties: { id: { type: 'string' }, type: { const: 'note' }, title: { type: 'string' }, content: { type: 'string' }, updated_at: { type: 'string' } }, required: ['id', 'type', 'title', 'content'], additionalProperties: false },
    disclosure: { search: { enabled: true, fields: ['title', 'content'] } },
  } };
}

describe('managed mutation consistency', function describeManagedMutation() {
  it('rejects one stale concurrent update without overwriting the winning fields', async function rejectsLostUpdate() {
    const { service, storage } = localHome('conflicting-updates');
    storage.add(buildEntity({ id: 'TASK-0001', title: 'Old title', content: 'Old body' }));
    const original = service.getForWrite.bind(service);
    let release: (() => void) | undefined;
    const barrier = new Promise<void>(function createBarrier(resolve) { release = resolve; });
    let reads = 0;
    vi.spyOn(service, 'getForWrite').mockImplementation(async function readTogether(id) {
      const preimage = await original(id);
      if (++reads === 2) release?.();
      await barrier;
      return preimage;
    });
    const { context, append } = journal();
    const results = await Promise.allSettled([
      updateEntity(service, { id: 'TASK-0001', title: 'New title' }, context, UPDATE),
      updateEntity(service, { id: 'TASK-0001', fields: { content: 'New body' } }, context, UPDATE),
    ]);
    expect(results.filter(function succeeded(result) { return result.status === 'fulfilled'; })).toHaveLength(1);
    expect(results.find(function failed(result) { return result.status === 'rejected'; })).toMatchObject({ reason: expect.any(EntityWriteConflictError) });
    expect(append).toHaveBeenCalledTimes(1);
    const current = await service.get('TASK-0001');
    expect(current?.title === 'New title' || current?.content === 'New body').toBe(true);
    expect(current?.title === 'New title' && current?.content === 'New body').toBe(false);
  });

  it('detects native byte edits even when the projected entity is unchanged', async function rejectsNativeRevision() {
    const { service, storage } = localHome('native-revision-conflict');
    storage.add(buildEntity({ id: 'TASK-0001', title: 'Original', content: 'Body' }));
    const preimage = await service.getForWrite('TASK-0001');
    const file = storage.getFilePath('TASK-0001');
    if (preimage === undefined || file === null) throw new Error('Missing fixture');
    const edited = readFileSync(file, 'utf8').replace('---\n', '---\n# Human formatting note\n');
    writeFileSync(file, edited);
    const { context, append, emit } = journal();
    await expect(updateEntityPostimage(service, preimage.entity, { ...preimage.entity, title: 'Stale edit' }, { title: 'Stale edit' }, context, UPDATE, preimage)).rejects.toBeInstanceOf(EntityWriteConflictError);
    expect(readFileSync(file, 'utf8')).toBe(edited);
    expect(append).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('acknowledges committed create/save/delete and repairs an index failure without repeating writes', async function acknowledgesIndexFailure() {
    const { service, search } = localHome('committed-index-failure');
    await service.reconcile();
    const { context, append } = journal();
    vi.spyOn(search, 'addDocument').mockRejectedValueOnce(new Error('Index unavailable'));
    const created = await createEntity(service, { type: 'task', title: 'Needle work', content: 'Old' }, context, CREATE);
    expect(created.warnings?.[0]?.code).toBe('index_repair_pending');
    expect(await service.scan({ type: 'task' })).toHaveLength(1);
    expect((await service.searchUnified('Needle'))[0]?.item.id).toBe(created.id);
    vi.spyOn(search, 'updateDocument').mockRejectedValueOnce(new Error('Update unavailable'));
    expect((await updateEntity(service, { id: created.id, title: 'Updated needle' }, context, UPDATE)).warnings?.[0]?.code).toBe('index_repair_pending');
    expect((await service.searchUnified('Updated needle'))[0]?.item.title).toBe('Updated needle');
    vi.spyOn(search, 'removeDocument').mockRejectedValueOnce(new Error('Remove unavailable'));
    expect((await deleteItem(service, { id: created.id }, context, { tool: 'backlog delete', mutation: 'delete' })).warnings?.[0]?.code).toBe('index_repair_pending');
    expect(await service.searchUnified('Needle')).toEqual([]);
    expect(append).toHaveBeenCalledTimes(3);
    service.flush();
  });

  it('covers projector preparation failure after a real custom document commit', async function acknowledgesProjectorFailure() {
    const runtime = localHome('committed-projector', [noteDefinition()]);
    let broken = true;
    const service = new BacklogService({ ...runtime, getSearchFields: function fields(type) { if (broken) throw new Error('Projector unavailable'); return runtime.registry.getSearchFields(type); } });
    const { context, append } = journal();
    const created = await createEntity(service, { type: 'note', title: 'Needle note', content: 'Body' }, context, CREATE);
    expect(created.warnings?.[0]?.code).toBe('index_repair_pending');
    expect(await service.scan({ type: 'note' })).toHaveLength(1);
    expect(append).toHaveBeenCalledTimes(1);
    broken = false;
    expect((await service.searchUnified('Needle'))[0]?.item.id).toBe(created.id);
    service.flush();
  });

  it('preserves absent and author-owned custom timestamps on body edits', async function stampsCustomBodies() {
    for (const updated_at of [undefined, 'author-owned']) {
      const { service } = localHome(`custom-body-${updated_at}`, [noteDefinition()]);
      const created = await service.create({ type: 'note', title: 'Note', content: 'Old', ...(updated_at === undefined ? {} : { updated_at }) });
      expect((await editItem(service, { id: created.id, operation: { type: 'str_replace', old_str: 'Old', new_str: 'New' } }, journal().context, EDIT)).success).toBe(true);
      const stored = await service.get(created.id);
      expect(stored?.content).toBe('New');
      expect(stored?.updated_at).toBe(updated_at);
    }
  });

  it('reports throwing journal and event sinks as warnings after a successful body edit', async function acknowledgesSinkFailure() {
    const { service, storage } = localHome('committed-sink-failure');
    storage.add(buildEntity({ id: 'TASK-0001', title: 'Work', content: 'Old' }));
    const { context, append, emit } = journal();
    append.mockImplementation(function failJournal() { throw new Error('Journal failure'); });
    emit.mockImplementation(function failNotification() { throw new Error('Subscriber failure'); });
    const result = await editItem(service, { id: 'TASK-0001', operation: { type: 'str_replace', old_str: 'Old', new_str: 'New' } }, context, EDIT);
    expect(result.success).toBe(true);
    expect(result.warnings?.map(function code(warning) { return warning.code; })).toEqual(['journal_append_failed', 'notification_failed']);
    expect((await service.get('TASK-0001'))?.content).toBe('New');
    expect(append).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
