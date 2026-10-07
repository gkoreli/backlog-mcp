/** Native ADR schema, compatible lifecycle and progressive discovery; filesystem is memfs. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdrSchema, EntityType, formatEntityId, getTypeFromId, isValidEntityId, parseEntityId } from '@backlog-mcp/shared';
import { createBacklogHome } from '../storage/local/backlog-home.js';
import { DocsNativeFilesystemStorage } from '../storage/local/docs-native-filesystem-storage.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import { createBuiltinSubstrateRegistrations, loadProjectSubstrateDefinitions } from '../core/substrates/index.js';
import { executeSubstrateIntent } from '../core/substrates/execute-substrate-intent.js';
import { resolveSubstrateAction } from '../core/substrates/action-catalog.js';
import { listItems } from '../core/list.js';
import { searchItems } from '../core/search.js';
import { projectDocumentDiscovery } from '../core/project-document-discovery.js';
import { compileSubstrateDisclosure } from '../core/substrates/compile-substrate-disclosure.js';
import type { IBacklogService } from '../core/backlog-service.contract.js';
import type { WriteContext } from '../core/types.js';
import type { RuntimeSubstrateDefinition } from '@backlog-mcp/shared';

const builtins = createBuiltinSubstrateRegistrations(new BuiltinSubstrateStorageCatalog());
const registry = loadProjectSubstrateDefinitions([], builtins).registry;

describe('native ADR substrate', function nativeAdrSuite() {
  it('owns the compiled ADR contract and canonical root/thread identity grammar', function nativeContract() {
    expect(registry.getSubstrate('adr')?.kind).toBe('compiled');
    expect(registry.listIntents().filter(function adrIntent(intent) { return intent.substrateType === 'adr'; })).toHaveLength(3);
    expect(formatEntityId(106, EntityType.Adr)).toBe('ADR 0106');
    expect(isValidEntityId('ADR 0106.7.1')).toBe(true);
    expect(getTypeFromId('ADR 0106.7')).toBe(EntityType.Adr);
    expect(parseEntityId('ADR 0106.7')).toEqual({ type: EntityType.Adr, num: 106 });
    expect(isValidEntityId('ADR 0106.bad')).toBe(false);
    expect(isValidEntityId('TASK-0001')).toBe(true);
    expect(resolveSubstrateAction(registry, 'adr.propose').intentInputSchema.safeParse({ title: 'Decision', content: 'R1' }).success).toBe(false);
    expect(resolveSubstrateAction(registry, 'adr.propose').intentInputSchema.safeParse({ title: 'Decision', description: 'x'.repeat(321), content: 'R1' }).success).toBe(false);
  });

  it('accepts a pre-promotion managed ADR without requiring new frontmatter', async function compatibleLifecycle() {
    const root = '/native-adr/compatible';
    mkdirSync(`${root}/docs/adr`, { recursive: true });
    writeFileSync(`${root}/docs/adr/0001-managed.md`, '---\nid: ADR 0001\ntype: adr\ntitle: Original managed decision\nstatus: proposed\n---\nOriginal body.\n');
    const storage = new DocsNativeFilesystemStorage(createBacklogHome({ kind: 'project', root }), registry);
    const append = vi.fn();
    const context: WriteContext = {
      actor: { type: 'agent', name: 'test' }, clock: function clock() { return Date.parse('2026-10-07T00:00:00.000Z'); },
      operationLog: { append, query: async function query() { return []; }, countForTask: async function count() { return 0; } },
    };
    const service = {
      getForWrite: async function get(id: string) { return storage.getForWrite(id); },
      saveCommitted: async function save(entity, options) { return { value: storage.save(entity, options) }; },
    } as IBacklogService;
    const result = await executeSubstrateIntent({ intent: resolveSubstrateAction(registry, 'adr.accept'), input: { id: 'ADR 0001' }, service, validator: registry, context });
    expect(result).toMatchObject({ changed: true, ids: ['ADR 0001'] });
    expect(storage.get('ADR 0001')).toMatchObject({ status: 'accepted', content: 'Original body.' });
    expect(storage.get('ADR 0001')).not.toHaveProperty('created_at');
    expect(storage.get('ADR 0001')).not.toHaveProperty('description');
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('preserves an empty Markdown body through storage and lifecycle actions', async function emptyBodyLifecycle() {
    const root = '/native-adr/empty-body';
    mkdirSync(`${root}/docs/adr`, { recursive: true });
    const home = createBacklogHome({ kind: 'project', root });
    const storage = new DocsNativeFilesystemStorage(home, registry);
    storage.add(AdrSchema.parse({
      id: 'ADR 0001', type: 'adr', title: 'Empty body', status: 'proposed',
      description: 'A decision whose empty body is valid in the canonical schema.', content: '',
    }));
    const reopened = new DocsNativeFilesystemStorage(home, registry);
    expect(reopened.get('ADR 0001')).toMatchObject({ content: '' });
    const service = {
      getForWrite: async function get(id: string) { return reopened.getForWrite(id); },
      saveCommitted: async function save(entity, options) { return { value: reopened.save(entity, options) }; },
    } as IBacklogService;
    const result = await executeSubstrateIntent({
      intent: resolveSubstrateAction(registry, 'adr.accept'), input: { id: 'ADR 0001' }, service, validator: registry,
      context: { actor: { type: 'agent', name: 'test' }, clock: function clock() { return Date.parse('2026-10-07T00:00:00.000Z'); } },
    });
    expect(result).toMatchObject({ changed: true, ids: ['ADR 0001'] });
    expect(reopened.get('ADR 0001')).toMatchObject({ status: 'accepted', content: '' });
  });

  it('returns description, real filename and thread cues before explicit body hydration', async function progressiveReads() {
    const root = '/native-adr/discovery';
    mkdirSync(`${root}/docs/adr`, { recursive: true });
    const storage = new DocsNativeFilesystemStorage(createBacklogHome({ kind: 'project', root }), registry);
    const entity = storage.add(AdrSchema.parse({
      id: 'ADR 0106.7', type: 'adr', title: 'Revise operation contracts', status: 'proposed',
      description: 'Require shared core validation for all declared operation callers.',
      content: 'A long explanation that is not needed during discovery.', date: '2026-10-07', extends: ['ADR 0106'],
    }));
    const service = {
      list: vi.fn(async function list() { return [entity]; }), counts: vi.fn(),
      getDiscoveryProjection: registry.getDiscoveryProjection.bind(registry),
      getDocumentDiscovery: storage.getDocumentDiscovery.bind(storage),
      searchUnified: vi.fn(async function search() { return [{ id: entity.id, type: 'adr', item: entity, score: 1, snippet: { text: 'Body match', matched_fields: ['content'] } }]; }),
    } as unknown as IBacklogService;
    const listed = (await listItems(service, { type: 'adr' })).tasks[0];
    expect(listed).toMatchObject({ description: entity.description, source_path: 'adr/0106.7-revise-operation-contracts.md', thread_root: 'ADR 0106', thread_parent: 'ADR 0106', metadata: { date: '2026-10-07', extends: ['ADR 0106'] } });
    expect(listed).not.toHaveProperty('content');
    const found = (await searchItems(service, { query: 'operation' })).results[0];
    expect(found).toMatchObject({ description: entity.description, matched_fields: ['content'] });
    expect(found).not.toHaveProperty('snippet');
    expect(found).not.toHaveProperty('content');
    expect((await searchItems(service, { query: 'operation', include_content: true })).results[0]).toMatchObject({ content: entity.content, snippet: 'Body match' });
  });

  it('bounds native metadata and rejects eager body disclosure declarations', function boundedMetadata() {
    const result = projectDocumentDiscovery({ id: 'ADR 0001', type: 'adr', title: 'Native', description: 'x'.repeat(1000), content: 'Never disclose here', extends: Array.from({ length: 20 }, function reference(_, index) { return `ADR ${index}`; }) }, registry);
    expect(result.description).toHaveLength(320);
    expect(result.metadata?.extends).toHaveLength(10);
    expect(result.discovery_truncated).toBe(true);
    expect(result).not.toHaveProperty('content');
    const definition = { definitionVersion: 1, type: 'doc', label: { singular: 'Doc', plural: 'Docs' }, folder: 'docs', identity: { strategy: 'numbered' }, schema: { properties: { content: { type: 'string' } } }, disclosure: { discovery: { projection: ['content'] } } } as RuntimeSubstrateDefinition;
    expect(compileSubstrateDisclosure(definition).issues).toContainEqual(expect.objectContaining({ path: '/disclosure/discovery/projection' }));
  });
});
