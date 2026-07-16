/**
 * Built-in wakeup-section name reservation (ADR 0113 C.2 precondition,
 * beryl's carried 0113.1 guardrail): the briefing composes identity/scope/
 * now/knowledge/recent/metadata/vision itself — a substrate claiming one of
 * those section names is rejected (project-declarative) or throws
 * (packaged), mirroring the reservedToolNames law.
 */
import { describe, it, expect } from 'vitest';
import { compileSubstrateDefinition } from '../core/substrates/compile-substrate-definition.js';
import { createProjectSubstrateRegistry } from '../core/substrates/project-substrate-registry.js';
import { RESERVED_WAKEUP_SECTIONS } from '../core/substrates/load-substrate-definitions.js';
import type { CompiledSubstrateDefinition } from '../core/substrates/types.js';

function compiledWithSection(section: string, sourcePath: string): CompiledSubstrateDefinition {
  const result = compileSubstrateDefinition({
    sourcePath,
    value: {
      definitionVersion: 1,
      type: 'fieldnote',
      label: { singular: 'fieldnote', plural: 'fieldnotes' },
      folder: 'fieldnotes',
      identity: { strategy: 'numbered', minimumDigits: 4, displayTemplate: '{key}' },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          type: { const: 'fieldnote' },
          title: { type: 'string', minLength: 1 },
          content: { type: 'string' },
        },
        required: ['id', 'type', 'title'],
        additionalProperties: false,
      },
      disclosure: {
        wakeup: { section, limit: 5, projection: ['id', 'title'] },
      },
    },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostic));
  return result.substrate;
}

describe('reserved wakeup section names', () => {
  it('rejects a project-declarative substrate claiming a reserved section, with a diagnostic', () => {
    const result = createProjectSubstrateRegistry({
      packaged: [],
      project: [compiledWithSection('knowledge', 'docs/substrates/fieldnote.json')],
      reservedWakeupSections: ['knowledge'],
    });
    expect(result.registry.getSubstrate('fieldnote')).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.issues[0]?.message).toContain('reserved by the consumer');
    expect(result.diagnostics[0]?.issues[0]?.path).toBe('/disclosure/wakeup/section');
  });

  it('throws for a packaged substrate claiming a reserved section (wiring bug, fail loud)', () => {
    expect(() => createProjectSubstrateRegistry({
      packaged: [compiledWithSection('recent', 'builtin:fieldnote@1')],
      project: [],
      reservedWakeupSections: ['recent'],
    })).toThrow(/reserved by the consumer/);
  });

  it('unreserved sections register normally', () => {
    const result = createProjectSubstrateRegistry({
      packaged: [],
      project: [compiledWithSection('fieldnotes', 'docs/substrates/fieldnote.json')],
      reservedWakeupSections: [...RESERVED_WAKEUP_SECTIONS],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.registry.getDisclosure('fieldnote')?.wakeup?.section).toBe('fieldnotes');
  });

  it('the default reserved set covers the briefing-composed names, not constraints', () => {
    expect(RESERVED_WAKEUP_SECTIONS).toContain('knowledge');
    expect(RESERVED_WAKEUP_SECTIONS).toContain('vision');
    expect(RESERVED_WAKEUP_SECTIONS).not.toContain('constraints');
  });
});
