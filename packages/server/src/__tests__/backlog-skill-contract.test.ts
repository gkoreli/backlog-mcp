/** Repository probe: read authored reference examples; all write effects remain mocked. */
import { describe, expect, it, vi } from 'vitest';
import { compileSubstrateDefinition, createBuiltinSubstrateRegistrations, loadProjectSubstrateDefinitions } from '../core/substrates/index.js';
import { RESERVED_TOOL_NAMES } from '../core/substrates/tool-name-reservations.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';

const fs = await vi.importActual<typeof import('node:fs')>('node:fs');

function definitionFromReference(name: string): Record<string, unknown> {
  const content = fs.readFileSync(new URL(`../../../../.agents/skills/backlog/references/${name}.md`, import.meta.url), 'utf8');
  const examples = [...content.matchAll(/```json\n([\s\S]*?)\n```/gu)].map(function parseExample(match) {
    const body = match[1];
    if (body === undefined) throw new Error(`Empty JSON example in ${name}`);
    return JSON.parse(body);
  });
  const definition = examples.find(example => example.definitionVersion !== undefined);
  if (!definition) throw new Error(`No substrate definition in reference ${name}`);
  return definition;
}

const builtins = createBuiltinSubstrateRegistrations(new BuiltinSubstrateStorageCatalog());

function loadExample(value: Record<string, unknown>) {
  return loadProjectSubstrateDefinitions([{
    sourcePath: `substrates/${value.type}.json`,
    absolutePath: `/project/docs/substrates/${value.type}.json`,
    value,
  }], builtins, RESERVED_TOOL_NAMES);
}

describe('backlog usage skill declaration examples', () => {
  it('registers the new RFC alongside packaged types with actionable input contracts', () => {
    const result = loadExample(definitionFromReference('custom-substrates'));
    expect(result.diagnostics).toEqual([]);
    const intents = result.registry.listIntents();
    const propose = intents.find(intent => intent.toolName === 'backlog_propose_rfc');
    const accept = intents.find(intent => intent.toolName === 'backlog_accept_rfc');
    expect(propose?.intentInputSchema.safeParse({ title: 'Caching', content: 'Decision context', status: 'accepted' }).success).toBe(false);
    expect(propose?.intentInputSchema.safeParse({ title: 'Caching' }).success).toBe(false);
    expect(propose?.intentInputSchema.safeParse({ title: 'Caching', content: 'Decision context', addresses: ['TASK-0001'] }).success).toBe(true);
    expect(propose?.operation).toMatchObject({ kind: 'create', fixedFields: { status: 'proposed' } });
    expect(accept?.operation).toMatchObject({ kind: 'transition', transition: { field: 'status', from: ['proposed'], to: 'accepted' } });
    expect(intents.some(intent => intent.toolName === 'backlog_propose_adr')).toBe(true);
    expect(result.registry.validateWrite({ id: 'RFC-0001', type: 'rfc', title: 'Caching', content: 'Decision context', status: 'proposed' }).ok).toBe(true);
  });

  it('keeps native ADR ownership singular and rejects a project replacement', function nativeOwnership() {
    const rejected = loadExample({
      ...definitionFromReference('custom-substrates'), type: 'adr', replaces: 'builtin:adr@compiled',
    });
    expect(rejected.diagnostics).not.toEqual([]);
    expect(rejected.registry.getSubstrate('adr')?.kind).toBe('compiled');
    const intents = rejected.registry.listIntents();
    for (const name of ['backlog_propose_adr', 'backlog_accept_adr', 'backlog_supersede_adr']) {
      expect(intents.filter(function matches(intent) { return intent.toolName === name; })).toHaveLength(1);
    }
    const propose = intents.find(function isPropose(intent) { return intent.toolName === 'backlog_propose_adr'; });
    expect(propose?.intentInputSchema.safeParse({ title: 'Decision', description: 'Use for storage choices.', content: 'R1', thread: 'ADR 0106' }).success).toBe(true);
    expect(propose?.intentInputSchema.safeParse({ title: 'Decision', content: 'R1' }).success).toBe(false);
  });

  it('rejects an unsafe folder in the documented new-type example', () => {
    const result = compileSubstrateDefinition({
      sourcePath: 'substrates/rfc.json',
      value: { ...definitionFromReference('custom-substrates'), folder: '../outside' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.issues).toContainEqual(expect.objectContaining({ path: '/folder', code: 'unsafe' }));
  });
});
