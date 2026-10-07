/** Declared CLI dispatch uses the selected-home core contract; runtime effects are mocked. */
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import type { CliRuntime } from '../cli/runner.types.js';
import { registerActions } from '../cli/commands/actions.js';
import { formatDocumentDiscovery } from '../cli/commands/document-discovery-output.js';
import { createBuiltinSubstrateRegistrations, loadProjectSubstrateDefinitions } from '../core/substrates/index.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import type { EntityDraft } from '../core/entity-creation.contract.js';

const state = vi.hoisted(function state() { return { runtime: undefined as CliRuntime | undefined, result: undefined as unknown }; });
vi.mock('../cli/runner.js', function runnerMock() {
  return {
    run: async function run(operation: (runtime: CliRuntime) => Promise<unknown>) {
      if (state.runtime === undefined) throw new Error('Missing CLI fixture');
      state.result = await operation(state.runtime);
    },
    cliRuntimeDependencies: function dependencies() { return {}; },
    withAgentIdentity: function identity(deps: unknown) { return deps; },
  };
});

function program() {
  const result = new Command().exitOverride().option('--json');
  registerActions(result);
  return result;
}

describe('CLI declared actions', function cliActionsSuite() {
  it('uses the selected catalog for discovery and a core-validated threaded ADR action', async function selectedCatalog() {
    const registry = loadProjectSubstrateDefinitions([], createBuiltinSubstrateRegistrations(new BuiltinSubstrateStorageCatalog())).registry;
    const createThreadChildCommitted = vi.fn(async function create(draft: EntityDraft, thread: string) {
      expect(thread).toBe('ADR 0106');
      return { value: { ...draft, id: 'ADR 0106.7' } };
    });
    const append = vi.fn();
    state.runtime = {
      service: { createThreadChildCommitted }, intentRegistry: registry, intentValidator: registry,
      writeContext: { actor: { type: 'agent', name: 'test' }, operationLog: { append, query: async function query() { return []; } } },
    } as unknown as CliRuntime;
    await program().parseAsync(['actions', 'adr'], { from: 'user' });
    expect(state.result).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'backlog_propose_adr', executable: true, inputSchema: expect.objectContaining({ required: ['title', 'description', 'content'] }) })]));
    await program().parseAsync(['act', 'adr.propose', '--input', JSON.stringify({ thread: 'ADR 0106', title: 'Contracts', description: 'Use common validation.', content: 'R1' })], { from: 'user' });
    expect(state.result).toMatchObject({ ids: ['ADR 0106.7'], changed: true });
    expect(createThreadChildCommitted).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(1);
    await expect(program().parseAsync(['act', 'adr.propose', '--input', '{"title":"Missing description","content":"R1"}'], { from: 'user' })).rejects.toThrow('description');
    await expect(program().parseAsync(['act', 'adr.propose', '--input', '[]'], { from: 'user' })).rejects.toThrow('JSON object');
    await expect(program().parseAsync(['act', 'other.propose', '--input', '{}'], { from: 'user' })).rejects.toThrow('Unknown');
    expect(createThreadChildCommitted).toHaveBeenCalledTimes(1);
    state.runtime.intentRegistry = { listIntents: function noActions() { return []; } };
    await expect(program().parseAsync(['act', 'adr.propose', '--input', '{}'], { from: 'user' })).rejects.toThrow('Unknown');
  });

  it('renders authored descriptions, source paths and thread cues in text discovery', function textDiscovery() {
    expect(formatDocumentDiscovery({ description: 'Read before changing contracts.', source_path: 'adr/0106.7-contracts.md', thread_root: 'ADR 0106', thread_parent: 'ADR 0106', metadata: { date: '2026-10-07' } }).join('\n')).toContain('Read before changing contracts.');
    expect(formatDocumentDiscovery({ source_path: 'adr/0106.7-contracts.md', thread_root: 'ADR 0106' }).join('\n')).toContain('adr/0106.7-contracts.md · thread ADR 0106');
  });
});
