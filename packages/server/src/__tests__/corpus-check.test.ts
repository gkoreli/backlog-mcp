/** Pure corpus integrity checks use supplied document snapshots and a mocked YAML codec. */
import { describe, expect, it } from 'vitest';
import type { RuntimeSubstrateDefinition } from '@backlog-mcp/shared';
import { checkCorpus } from '../core/corpus-check.js';
import type { CheckCorpusParams } from '../core/corpus-check.contract.js';
import { parseDocumentIdentity } from '../core/document-identity.js';
import type { DiscoveredDocument } from '../core/document-discovery.types.js';
import { createBuiltinSubstrateRegistrations, loadProjectSubstrateDefinitions } from '../core/substrates/index.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';

const yaml = { parse: JSON.parse, stringify: JSON.stringify };
const builtins = createBuiltinSubstrateRegistrations(new BuiltinSubstrateStorageCatalog());

function document(sourcePath: string, data: Record<string, unknown>, body = 'Body.'): DiscoveredDocument {
  return { sourcePath, absolutePath: `/home/docs/${sourcePath}`, format: 'markdown', content: `---\n${JSON.stringify(data)}\n---\n${body}`, identity: parseDocumentIdentity({ sourcePath, declaredId: data.id }) };
}

function params(documents: DiscoveredDocument[]): CheckCorpusParams {
  const loaded = loadProjectSubstrateDefinitions([], builtins);
  return { homeKey: '/home', discovery: { documents, declarations: [], substrateHistory: [], diagnostics: [] }, registry: loaded.registry, registryDiagnostics: loaded.diagnostics, yaml };
}

describe('read-only corpus integrity', function corpusChecks() {
  it('validates authored metadata without masking identity, type or title defects', function authoredFields() {
    const input = params([document('adr/0001-decision.md', { id: 'ADR 0999', type: 'adr', status: 'accepted' })]);
    const before = JSON.stringify(input.discovery);
    const report = checkCorpus(input);
    expect(report.valid).toBe(false);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'identity-mismatch', field: '/id' }));
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'schema-invalid', field: '/title' }));
    expect(JSON.stringify(input.discovery)).toBe(before);
  });

  it('keeps resources distinct from misfiled entity metadata and numbered claims', function classifications() {
    const report = checkCorpus(params([
      document('guides/setup.md', {}), document('reports/0001-study.md', {}),
      document('reports/0002-misfiled.md', { id: 'ADR 0002', type: 'adr', title: 'Wrong folder' }),
      document('adr/TASK-0003-wrong-prefix.md', {}),
    ]));
    expect(report.summary).toMatchObject({ entities: 2, resources: 2 });
    expect(report.diagnostics.filter(function errors(d) { return d.code === 'unclaimed-entity'; })).toHaveLength(2);
    expect(report.diagnostics.filter(function warning(d) { return d.code === 'unclaimed-numbered-document'; })).toHaveLength(1);
  });

  it('checks undisclosed declared relations without requiring inverse fields or new lifecycle policy', function completeRelations() {
    const definition: RuntimeSubstrateDefinition = {
      definitionVersion: 1, type: 'rfc', label: { singular: 'RFC', plural: 'RFCs' }, folder: 'rfcs', identity: { strategy: 'prefixed-number', prefix: 'RFC', minimumDigits: 4 },
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, type: { const: 'rfc' }, title: { type: 'string' }, content: { type: 'string' }, cites: { type: 'array', maxItems: 10, items: { type: 'string' } } }, required: ['id', 'type', 'title'] },
      relations: { cites: { targets: ['adr'], cardinality: 'many', inverse: 'cited_by' } },
    };
    const input = params([
      document('rfcs/RFC-0001-proposal.md', { id: 'RFC-0001', type: 'rfc', title: 'Proposal', cites: ['RFC-0001', 'ADR 9999', 'RFC-0002', 'ADR 0001'] }),
      document('rfcs/RFC-0002-other.md', { id: 'RFC-0002', type: 'rfc', title: 'Other' }),
      document('adr/0001-decision.md', { id: 'ADR 0001', type: 'adr', title: 'Decision', status: 'proposed', description: 'Decision context.' }),
    ]);
    const loaded = loadProjectSubstrateDefinitions([{ sourcePath: 'substrates/rfc.json', absolutePath: '/home/docs/substrates/rfc.json', value: definition }], builtins);
    input.registry = loaded.registry; input.registryDiagnostics = loaded.diagnostics;
    expect(loaded.registry.listDisclosureRelations().some(function rfc(relation) { return relation.sourceType === 'rfc'; })).toBe(false);
    const report = checkCorpus(input);
    expect(report.diagnostics.map(function code(d) { return d.code; })).toEqual(expect.arrayContaining(['self-relation', 'dangling-relation', 'relation-target-type']));
    expect(report.diagnostics.filter(function related(d) { return d.related_ids?.includes('ADR 0001'); })).toEqual([]);
  });

  it('fails closed on unavailable scans or declarations and retains nonfatal history warnings', function completeness() {
    const input = params([]);
    input.discovery.diagnostics = [{ code: 'file-unreadable', message: 'Unreadable', sourcePaths: ['adr/0001.md'] }];
    input.registryDiagnostics = [{ code: 'missing-version-history', sourcePath: 'substrates/rfc.json', issues: [{ code: 'history', path: '/definitionVersion', message: 'Missing history' }] }];
    expect(checkCorpus(input)).toMatchObject({ complete: false, valid: false, summary: { errors: 1, warnings: 1 } });
    input.discovery.diagnostics = [];
    expect(checkCorpus(input)).toMatchObject({ complete: true, valid: true, summary: { errors: 0, warnings: 1 } });
    input.registryDiagnostics = [{ code: 'invalid-substrate-definition', sourcePath: 'substrates/rfc.json', issues: [{ code: 'shape', path: '/schema', message: 'Invalid schema' }] }];
    expect(checkCorpus(input)).toMatchObject({ complete: false, valid: false });
  });

  it('reports missing bytes and frontmatter explicitly and does not mask managed defaults', function rawContracts() {
    const missing = document('adr/0001-missing.md', {});
    missing.content = undefined;
    expect(checkCorpus(params([missing]))).toMatchObject({ complete: false, valid: false });
    const bare = document('adr/0001-bare.md', {});
    bare.content = '# A title is not authored metadata.\n';
    expect(checkCorpus(params([bare])).diagnostics).toContainEqual(expect.objectContaining({ code: 'missing-frontmatter' }));
    const task = document('tasks/TASK-0001-default.md', { id: 'TASK-0001', type: 'task', title: 'Default status', created_at: '2026-10-07', updated_at: '2026-10-07' });
    expect(checkCorpus(params([task])).diagnostics).toContainEqual(expect.objectContaining({ code: 'schema-normalization-required' }));
  });

  it('does not conceal an authored content field by substituting the Markdown body', function authoredContent() {
    const doc = document('adr/0001-content.md', { id: 'ADR 0001', type: 'adr', title: 'Decision', status: 'proposed', description: 'A decision.', content: 'Frontmatter body cannot replace Markdown.' });
    expect(checkCorpus(params([doc])).diagnostics).toContainEqual(expect.objectContaining({ code: 'schema-normalization-required' }));
  });

  it('reserves collision diagnostics and reports orphan threads without claiming supersession', function collisionAndThreads() {
    const metadata = { id: 'ADR 0001', type: 'adr', title: 'Decision', status: 'accepted', description: 'A decision.' };
    const collisions = checkCorpus(params([document('adr/0001-a.md', metadata), document('adr/nested/0001-b.md', metadata)]));
    expect(collisions.valid).toBe(false);
    expect(collisions.summary.entities).toBe(2);
    expect(collisions.diagnostics.filter(function duplicate(d) { return d.code === 'duplicate-substrate-document'; })).toHaveLength(2);
    const orphan = checkCorpus(params([document('adr/0001.2.3-child.md', { ...metadata, id: 'ADR 0001.2.3' })]));
    expect(orphan.valid).toBe(true);
    expect(orphan.diagnostics.filter(function missing(d) { return d.code === 'missing-thread-document'; })).toHaveLength(2);
  });
});
