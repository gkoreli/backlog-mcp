/** Minimal ports and shared context preserve adapter-selected authority. */
import { describe, expect, it, vi } from 'vitest';
import type { AnyEntity } from '@backlog-mcp/shared';
import { createManagedWriteContext, managedWriteDependencies } from '../composition/managed-write-context.js';
import { requireLocalManagedRepository } from '../composition/local-service-capabilities.js';
import { buildWriteContext } from '../tools/build-write-context.js';
import type { EntityUpdateRepository } from '../core/entity-repository.contract.js';
import { updateEntity } from '../core/update.js';
import { editItem } from '../core/edit.js';
import { localHome } from './helpers/local-home.js';

function writeDeps() {
  return { actor: { type: 'user', name: 'selected-user', delegatedBy: 'maintainer' } as const, operationLog: { append: vi.fn(), query: async function query() { return []; }, countForTask: async function count() { return 0; } }, scopeRoot: 'FLDR-0042', eventBus: { emit: vi.fn() } };
}

describe('managed write composition', function managedWrites() {
  it('requires selected actor/log and shares context construction with the MCP overlay', function authority() {
    const deps = writeDeps();
    expect(() => createManagedWriteContext(undefined)).toThrow('actor or operationLog');
    expect(() => createManagedWriteContext({ ...deps, operationLog: undefined })).toThrow('actor or operationLog');
    expect(buildWriteContext(deps)).toEqual(createManagedWriteContext(deps));
    const overlaid = buildWriteContext(deps, 'aime:granite');
    expect(overlaid.actor).toMatchObject({ type: 'agent', name: 'aime:granite', delegatedBy: 'maintainer' });
    expect(overlaid.scopeRoot).toBe('FLDR-0042');
    expect(overlaid.operationLog).toBe(deps.operationLog);
    expect(overlaid.eventBus).toBe(deps.eventBus);
    expect(deps.actor.name).toBe('selected-user');
    expect(managedWriteDependencies({ ...deps, service: 'extra' } as typeof deps)).not.toHaveProperty('service');
  });

  it('rejects missing local capabilities before admitting a writable graph', function requiredCapabilities() {
    const { service } = localHome('required-write-capabilities');
    expect(() => requireLocalManagedRepository(service)).not.toThrow();
    const scan = service.scan;
    vi.spyOn(service, 'scan').mockImplementation(scan);
    const incomplete = Object.assign(Object.create(service) as typeof service, { scanSync: undefined, correctMemory: undefined });
    expect(() => requireLocalManagedRepository(incomplete)).toThrow('scanSync, correctMemory');
  });

  it('runs core update/body edits with a typed get/save-only consumer and preserves custom timestamps', async function minimalConsumer() {
    let entity: AnyEntity = { id: 'NOTE 0001', type: 'note', title: 'Note', content: 'Original', updated_at: 'author-owned' };
    const save = vi.fn(async function save(candidate: AnyEntity, _options?: import('../core/entity-mutation.contract.js').StorageSaveOptions) { entity = candidate; return candidate; });
    const service: EntityUpdateRepository = { get: async function get() { return entity; }, save };
    const context = createManagedWriteContext(writeDeps());
    await updateEntity(service, { id: entity.id, title: 'Changed', fields: { nullable: null } }, context, { tool: 'test-update', mutation: 'update' });
    expect(entity.title).toBe('Changed');
    expect(entity).not.toHaveProperty('nullable');
    expect(save.mock.calls[0]?.[1]).toEqual({ expected: { entity: expect.objectContaining({ title: 'Note' }) } });
    expect((await editItem(service, { id: entity.id, operation: { type: 'str_replace', old_str: 'Original', new_str: 'New' } }, context, { tool: 'test-edit', mutation: 'resource-edit' })).success).toBe(true);
    expect(entity.updated_at).toBe('author-owned');
    expect(entity.content).toBe('New');
    expect(context.operationLog.append).toHaveBeenCalledTimes(2);
  });
});
