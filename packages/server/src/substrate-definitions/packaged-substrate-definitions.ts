import type { CompileSubstrateDefinitionParams } from '../core/substrates/types.js';

const DEFINITION_SCHEMA_URI = 'urn:backlog-mcp:schema:substrate-definition:1';
const JSON_SCHEMA_URI = 'https://json-schema.org/draft/2020-12/schema';

function canonicalDocumentSchema(
  type: string,
  properties: Record<string, unknown> = {},
  required: readonly string[] = [],
  allOf: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    $schema: JSON_SCHEMA_URI,
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200 },
      type: { const: type },
      title: { type: 'string', minLength: 1, maxLength: 300 },
      content: { type: 'string', maxLength: 2_000_000 },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
      ...properties,
    },
    required: [
      'id',
      'type',
      'title',
      'content',
      ...required,
    ],
    ...(allOf.length === 0 ? {} : { allOf }),
    additionalProperties: false,
  };
}

const REQUIREMENT_STATUS = [
  'intake',
  'ruled',
  'building',
  'done',
  'dropped',
] as const;
const REQUIREMENT_COMPLIANCE = [
  'unchecked',
  'satisfied',
  'at_risk',
  'violated',
  'not_applicable',
] as const;
const ASSESSED_COMPLIANCE = REQUIREMENT_COMPLIANCE.filter(
  function isAssessed(compliance) {
    return compliance !== 'unchecked';
  },
);

function stringArray(maxLength = 500): Record<string, unknown> {
  return {
    type: 'array',
    maxItems: 100,
    items: {
      type: 'string',
      maxLength,
    },
    uniqueItems: true,
  };
}

const REQUIREMENT_SCHEMA = canonicalDocumentSchema(
  'requirement',
  {
    status: {
      type: 'string',
      enum: REQUIREMENT_STATUS,
      default: 'intake',
    },
    compliance: {
      type: 'string',
      enum: REQUIREMENT_COMPLIANCE,
      default: 'unchecked',
    },
    domain: {
      oneOf: [
        { type: 'string', maxLength: 200 },
        stringArray(200),
      ],
    },
    date: { type: 'string', format: 'date' },
    uploaded_by: { type: 'string', maxLength: 200 },
    grounds_in: stringArray(2_000),
    spawned: stringArray(),
    supersedes: stringArray(),
    checked_at: { type: 'string', format: 'date-time' },
    checked_by: { type: 'string', maxLength: 200 },
    check_evidence: stringArray(2_000),
    violated_by: stringArray(),
  },
  ['status', 'compliance'],
  [
    {
      if: {
        properties: {
          compliance: { enum: ASSESSED_COMPLIANCE },
        },
        required: ['compliance'],
      },
      then: {
        required: ['checked_at', 'checked_by'],
      },
    },
    {
      if: {
        properties: {
          compliance: { const: 'satisfied' },
        },
        required: ['compliance'],
      },
      then: {
        properties: {
          violated_by: { type: 'array', maxItems: 0 },
        },
      },
    },
  ],
);

const ADR_STATUS = [
  'draft',
  'proposed',
  'living',
  'accepted',
  'deferred',
  'rejected',
  'superseded',
] as const;

const ADR_SCHEMA = canonicalDocumentSchema('adr', {
  status: {
    type: 'string',
    enum: ADR_STATUS,
  },
  date: { type: 'string', format: 'date' },
  supersedes: stringArray(),
  extends: stringArray(),
  implements: stringArray(),
  backlog_item: stringArray(),
  spawned_by: stringArray(),
  respects: stringArray(),
  violates: stringArray(),
});

const PROMPT_SCHEMA = canonicalDocumentSchema('prompt', {
  date: { type: 'string', format: 'date' },
  uploaded_by: { type: 'string', maxLength: 200 },
  supersedes: stringArray(),
  spawned: stringArray(),
});

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
      schema: ADR_SCHEMA,
      workflow: {
        field: 'status',
        initial: ['draft', 'proposed', 'living'],
        terminal: ['rejected', 'superseded'],
        transitions: [
          {
            name: 'accept',
            from: ['draft', 'proposed', 'living'],
            to: 'accepted',
          },
          {
            name: 'supersede',
            from: ['accepted', 'living'],
            to: 'superseded',
            requiresRelation: 'superseded_by',
          },
        ],
      },
      relations: {
        supersedes: {
          targets: ['adr'],
          cardinality: 'many',
          inverse: 'superseded_by',
        },
        extends: {
          targets: ['adr'],
          cardinality: 'many',
        },
        implements: {
          targets: ['adr', 'requirement', 'task'],
          cardinality: 'many',
          inverse: 'implemented_by',
        },
        backlog_item: {
          targets: ['task', 'epic', 'artifact'],
          cardinality: 'many',
        },
        spawned_by: {
          targets: ['prompt', 'requirement'],
          cardinality: 'many',
          inverse: 'spawned',
        },
        respects: {
          targets: ['requirement'],
          cardinality: 'many',
          inverse: 'respected_by',
        },
        violates: {
          targets: ['requirement'],
          cardinality: 'many',
          inverse: 'violated_by',
        },
      },
      intents: [
        {
          verb: 'propose',
          operation: 'create',
          description: 'Use when recording a proposed architectural decision in the current project.',
          requiredInputs: ['title', 'content'],
          optionalInputs: [
            'extends',
            'implements',
            'backlog_item',
            'spawned_by',
            'respects',
            'violates',
          ],
          defaults: {
            status: 'proposed',
          },
        },
        {
          verb: 'accept',
          operation: 'transition',
          description: 'Use when ratifying an existing proposed ADR.',
          requiredInputs: ['id'],
          transition: 'accept',
        },
        {
          verb: 'supersede',
          operation: 'relate-and-transition',
          description: 'Use when a newer ADR replaces an accepted or living ADR while preserving lineage.',
          requiredInputs: ['replacement_id', 'superseded_id'],
          relation: 'supersedes',
          sourceInput: 'replacement_id',
          targetInput: 'superseded_id',
          targetTransition: 'supersede',
        },
      ],
      disclosure: {
        search: {
          enabled: true,
          fields: ['title', 'content', 'status', 'date'],
        },
        get: {
          context: true,
          groupByRole: true,
          relations: [
            'supersedes',
            'extends',
            'implements',
            'backlog_item',
            'spawned_by',
            'respects',
            'violates',
          ],
        },
        wakeup: {
          section: 'decisions',
          includeStatuses: ['proposed', 'living'],
          limit: 5,
          projection: ['id', 'title', 'status'],
        },
      },
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
      schema: REQUIREMENT_SCHEMA,
      relations: {
        spawned: {
          targets: [
            'adr',
            'task',
            'epic',
            'folder',
            'artifact',
            'milestone',
            'cron',
          ],
          cardinality: 'many',
          inverse: 'spawned_by',
        },
        supersedes: {
          targets: ['requirement'],
          cardinality: 'many',
          inverse: 'superseded_by',
        },
        violated_by: {
          targets: [
            'adr',
            'task',
            'epic',
            'folder',
            'artifact',
            'milestone',
            'cron',
          ],
          cardinality: 'many',
          inverse: 'violates',
        },
      },
      intents: [
        {
          verb: 'capture_requirement',
          toolName: 'backlog_capture_requirement',
          operation: 'create',
          description: 'Use when recording a human or system requirement in the current project.',
          requiredInputs: ['title', 'content'],
          optionalInputs: [
            'status',
            'compliance',
            'domain',
            'date',
            'uploaded_by',
            'grounds_in',
            'spawned',
            'supersedes',
            'checked_at',
            'checked_by',
            'check_evidence',
            'violated_by',
          ],
          defaults: {
            status: 'intake',
            compliance: 'unchecked',
          },
        },
      ],
      disclosure: {
        search: {
          enabled: true,
          fields: [
            'title',
            'content',
            'status',
            'compliance',
            'domain',
            'check_evidence',
          ],
        },
        get: {
          context: true,
          groupByRole: true,
          relations: ['spawned', 'supersedes', 'violated_by'],
        },
        wakeup: {
          section: 'constraints',
          limit: 5,
          projection: [
            'id',
            'title',
            'domain',
            'status',
            'compliance',
            'checked_at',
            'violated_by',
          ],
        },
      },
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
      schema: PROMPT_SCHEMA,
      relations: {
        supersedes: {
          targets: ['prompt'],
          cardinality: 'many',
          inverse: 'superseded_by',
        },
        spawned: {
          targets: [
            'adr',
            'requirement',
            'task',
            'epic',
            'folder',
            'artifact',
            'milestone',
            'cron',
          ],
          cardinality: 'many',
          inverse: 'spawned_by',
        },
      },
      intents: [
        {
          verb: 'capture_prompt',
          toolName: 'backlog_capture_prompt',
          operation: 'create',
          description: 'Use when preserving a verbatim human directive as a chronological project prompt.',
          requiredInputs: ['title', 'content'],
          optionalInputs: [
            'date',
            'uploaded_by',
            'supersedes',
            'spawned',
          ],
        },
      ],
      disclosure: {
        search: {
          enabled: true,
          fields: ['title', 'content', 'date', 'uploaded_by'],
        },
        get: {
          context: true,
          groupByRole: true,
          relations: ['supersedes', 'spawned'],
        },
      },
    },
  },
] as const satisfies readonly CompileSubstrateDefinitionParams[];
