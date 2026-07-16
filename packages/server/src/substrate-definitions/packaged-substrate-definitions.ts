import type { CompileSubstrateDefinitionParams } from '../core/substrates/types.js';

const DEFINITION_SCHEMA_URI = 'urn:backlog-mcp:schema:substrate-definition:1';
const JSON_SCHEMA_URI = 'https://json-schema.org/draft/2020-12/schema';

function canonicalDocumentSchema(type: string): Record<string, unknown> {
  return {
    $schema: JSON_SCHEMA_URI,
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200 },
      type: { const: type },
      title: { type: 'string', minLength: 1, maxLength: 300 },
      content: { type: 'string', maxLength: 2_000_000 },
    },
    required: ['id', 'type', 'title'],
    additionalProperties: false,
  };
}

/**
 * Pre-installed declarative substrates.
 *
 * These are data-only definitions in a TypeScript module so the package bundler
 * embeds them without runtime asset-path or filesystem assumptions.
 */
export const PACKAGED_SUBSTRATE_DEFINITIONS = [
  {
    sourcePath: 'builtin:adr@1',
    value: {
      $schema: DEFINITION_SCHEMA_URI,
      definitionVersion: 1,
      type: 'adr',
      label: {
        singular: 'ADR',
        plural: 'ADRs',
      },
      folder: 'adr',
      identity: {
        strategy: 'numbered-threaded',
        minimumDigits: 4,
        displayTemplate: 'ADR {key}',
      },
      schema: canonicalDocumentSchema('adr'),
    },
  },
  {
    sourcePath: 'builtin:requirement@1',
    value: {
      $schema: DEFINITION_SCHEMA_URI,
      definitionVersion: 1,
      type: 'requirement',
      label: {
        singular: 'Requirement',
        plural: 'Requirements',
      },
      folder: 'requirements',
      identity: {
        strategy: 'prefixed-number',
        prefix: 'REQ',
        minimumDigits: 4,
        displayTemplate: 'REQ-{key}',
      },
      schema: canonicalDocumentSchema('requirement'),
    },
  },
  {
    sourcePath: 'builtin:prompt@1',
    value: {
      $schema: DEFINITION_SCHEMA_URI,
      definitionVersion: 1,
      type: 'prompt',
      label: {
        singular: 'Prompt',
        plural: 'Prompts',
      },
      folder: 'prompts',
      identity: {
        strategy: 'numbered',
        minimumDigits: 4,
        displayTemplate: 'PROMPT {key}',
      },
      schema: canonicalDocumentSchema('prompt'),
    },
  },
] as const satisfies readonly CompileSubstrateDefinitionParams[];
