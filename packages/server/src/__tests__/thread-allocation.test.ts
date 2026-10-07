/** Unit coverage for declared, engine-owned allocation; filesystem is memfs. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createBacklogHome } from '../storage/local/backlog-home.js';
import { DocsNativeFilesystemStorage } from '../storage/local/docs-native-filesystem-storage.js';
import { createBuiltinSubstrateRegistrations, loadProjectSubstrateDefinitions } from '../core/substrates/index.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import { allocateThreadChild } from '../core/substrates/thread-allocation.js';
import { executeSubstrateIntent } from '../core/substrates/execute-substrate-intent.js';
import { resolveSubstrateAction, describeSubstrateActions } from '../core/substrates/action-catalog.js';
import type { IBacklogService } from '../core/backlog-service.contract.js';
import type { WriteContext } from '../core/types.js';
import type { EntityDraft } from '../core/entity-creation.contract.js';
import { compileSubstrateIntents } from '../core/substrates/compile-substrate-intents.js';
import type { RuntimeSubstrateDefinition } from '@backlog-mcp/shared';

const registry = loadProjectSubstrateDefinitions([], createBuiltinSubstrateRegistrations(new BuiltinSubstrateStorageCatalog())).registry;
const draft = { type: 'adr', title: 'Revise operation contracts', description: 'Revise the common action contract.', created_at: '2026-10-07T00:00:00.000Z', updated_at: '2026-10-07T00:00:00.000Z', content: 'One declared operation.', status: 'proposed' };

function harness(name: string) {
  const root = `/thread-allocation/${name}`;
  mkdirSync(join(root, 'docs'), { recursive: true });
  const home = createBacklogHome({ kind: 'project', root });
  const storage = new DocsNativeFilesystemStorage(home, registry);
  function native(path: string, text = '---\ntitle: Original decision\nstatus: accepted\n---\nOriginal ruling.\n') {
    const absolute = join(home.documentsDir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
    return absolute;
  }
  return { home, storage, native };
}

describe('atomic thread allocation', function threadAllocationSuite() {
  it('collocates with a legacy thread, reserves quarantined and descendant claims, and preserves original bytes', function collocation() {
    const { storage, native } = harness('nested');
    const path = native('adr/architecture/0106-one-operation.md');
    const original = readFileSync(path, 'utf8');
    native('adr/0106.2-invalid.md', '---\ntitle: [bad yaml\n---\nBroken.');
    native('adr/0106.6.1-orphan.md');
    native('adr/0107.99-unrelated.md');
    const child = storage.createThreadChild(draft, 'ADR 0106');
    expect(child.id).toBe('ADR 0106.7');
    expect(storage.getDocumentById(child.id)?.sourcePath).toBe('adr/architecture/0106.7-revise-operation-contracts.md');
    expect(child).not.toHaveProperty('thread');
    expect(child).not.toHaveProperty('parent_id');
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(storage.createThreadChild(draft, child.id).id).toBe('ADR 0106.7.1');
  });

  it('refreshes warmed views inside the shared write lock and keeps root allocation independent', function freshViews() {
    const { storage, home, native } = harness('fresh');
    native('adr/0106-thread.md');
    const second = new DocsNativeFilesystemStorage(home, registry);
    second.get('ADR 0106');
    expect(storage.createThreadChild(draft, 'ADR 0106').id).toBe('ADR 0106.1');
    expect(second.createThreadChild(draft, 'ADR 0106').id).toBe('ADR 0106.2');
    expect(second.create(draft).id).toBe('ADR 0107');
  });

  it('fails closed for wrong-home, wrong-type, malformed and duplicate thread identities', function invalidThreads() {
    const { storage, native } = harness('invalid');
    native('adr/0106-original.md');
    expect(function missing() { storage.createThreadChild(draft, 'ADR 9999'); }).toThrow('existing adr');
    expect(function wrongType() { storage.createThreadChild(draft, 'TASK-0001'); }).toThrow('existing adr');
    expect(function injectedPath() { storage.createThreadChild(draft, '../adr/0106.md'); }).toThrow('existing adr');
    native('adr/0106-duplicate.md');
    expect(function duplicate() { storage.createThreadChild(draft, 'ADR 0106'); }).toThrow('duplicate document identities');
  });

  it('rejects sequence exhaustion and supports declarative prefixed thread identities', function purePolicies() {
    const claim = { type: 'rfc', folder: 'rfcs', identity: { strategy: 'prefixed-number' as const, prefix: 'RFC', minimumDigits: 4 } };
    const document = { entity: { id: 'RFC-0001', type: 'rfc', title: 'Policy' }, sourcePath: 'rfcs/0001.md' };
    expect(allocateThreadChild({ claim, thread: 'RFC-0001', document, occupiedKeys: ['0001.9'] })).toEqual({ id: 'RFC-0001.10', folder: 'rfcs' });
    expect(function exhausted() {
      allocateThreadChild({ claim, thread: 'RFC-0001', document, occupiedKeys: ['0001.9007199254740991'] });
    }).toThrow('exhausted');
    expect(function outsideClaim() {
      allocateThreadChild({ claim, thread: 'RFC-0001', document: { ...document, sourcePath: 'elsewhere/0001.md' }, occupiedKeys: [] });
    }).toThrow('outside');
  });
});

describe('declared thread action contract', function threadContractSuite() {
  it('exposes the exact optional selector and omits it from canonical field bindings', function compiledContract() {
    const intent = resolveSubstrateAction(registry, 'adr.propose');
    expect(intent).toBe(resolveSubstrateAction(registry, 'backlog_propose_adr'));
    expect(intent.intentInputSchema.safeParse({ title: 'Amend', description: 'Amend R1.', content: 'R1', thread: 'ADR 0106' }).success).toBe(true);
    expect(intent.operation).toMatchObject({ allocation: { strategy: 'thread-child', threadInput: 'thread' } });
    if (intent.operation.kind === 'create') expect(intent.operation.fields.some(function isThread(binding) { return binding.field === 'thread'; })).toBe(false);
    const proposal = describeSubstrateActions(registry, 'adr').find(function isPropose(action) { return action.verb === 'propose'; });
    expect(proposal?.inputSchema).toMatchObject({ properties: { thread: { type: 'string' } } });
  });

  it('validates direct core callers and refuses an unavailable atomic capability without fallback', async function coreBoundary() {
    const { storage, native } = harness('core');
    native('adr/0106-thread.md');
    const append = vi.fn();
    const context: WriteContext = {
      actor: { type: 'agent', name: 'test' },
      operationLog: { append, query: async function query() { return []; }, countForTask: async function count() { return 0; } },
    };
    const createCommitted = vi.fn();
    const createThreadChildCommitted = vi.fn(async function child(candidate: EntityDraft, thread: string) {
      return { value: storage.createThreadChild(candidate, thread), warnings: [{ code: 'index_repair_pending' as const, message: 'Index unavailable' }] };
    });
    const service = { createCommitted, createThreadChildCommitted } as unknown as IBacklogService;
    const intent = resolveSubstrateAction(registry, 'adr.propose');
    const params = { intent, service, validator: registry, context };
    await expect(executeSubstrateIntent({ ...params, input: { title: 'Bad', thread: 'ADR 0106' } })).rejects.toThrow('content');
    await expect(executeSubstrateIntent({ ...params, input: { title: 'Bad', content: '', id: 'ADR 0106.99' } })).rejects.toThrow();
    expect(createThreadChildCommitted).not.toHaveBeenCalled();
    const result = await executeSubstrateIntent({ ...params, input: { title: draft.title, description: draft.description, content: draft.content, thread: 'ADR 0106' } });
    expect(result).toMatchObject({ ids: ['ADR 0106.1'], changed: true, warnings: [{ message: 'Index unavailable' }] });
    expect(append).toHaveBeenCalledTimes(1);
    expect(createCommitted).not.toHaveBeenCalled();
    delete service.createThreadChildCommitted;
    await expect(executeSubstrateIntent({ ...params, input: { title: 'Next', description: 'Next decision.', content: '', thread: 'ADR 0106' } })).rejects.toThrow('capability is unavailable');
    expect(createCommitted).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('rejects undeclared selectors, field collisions, defaults and non-threaded policies', function invalidDeclarations() {
    const definition: RuntimeSubstrateDefinition = {
      definitionVersion: 1, type: 'rfc', label: { singular: 'RFC', plural: 'RFCs' }, folder: 'rfcs',
      identity: { strategy: 'numbered-threaded' },
      schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } } },
      intents: [{ verb: 'propose', description: 'Propose.', operation: 'create', requiredInputs: ['title', 'content'], optionalInputs: ['thread'], allocation: { strategy: 'thread-child', threadInput: 'thread' } }],
    };
    expect(compileSubstrateIntents('rfc.json', definition).issues).toEqual([]);
    const intent = definition.intents?.[0];
    if (intent === undefined) throw new Error('Missing fixture action');
    const variants: RuntimeSubstrateDefinition[] = [
      { ...definition, identity: { strategy: 'numbered' } },
      { ...definition, intents: [{ ...intent, optionalInputs: [] }] },
      { ...definition, schema: { ...definition.schema, properties: { title: { type: 'string' }, content: { type: 'string' }, thread: { type: 'string' } } } },
      { ...definition, intents: [{ ...intent, defaults: { thread: 'RFC 0001' } }] },
    ];
    for (const variant of variants) expect(compileSubstrateIntents('rfc.json', variant).issues.length).toBeGreaterThan(0);
  });
});
