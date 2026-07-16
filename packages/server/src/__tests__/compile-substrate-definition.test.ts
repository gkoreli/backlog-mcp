import { describe, expect, it } from 'vitest';
import { compileSubstrateDefinition } from '../core/substrates/compile-substrate-definition.js';

const BASE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 200 },
    type: { const: 'adr' },
    title: { type: 'string', minLength: 1, maxLength: 300 },
  },
  required: ['id', 'type', 'title'],
  additionalProperties: false,
} as const;

function createDefinition(schema: Record<string, unknown> = BASE_SCHEMA): unknown {
  return {
    $schema: 'urn:backlog-mcp:schema:substrate-definition:1',
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
    schema,
  };
}

function compile(value: unknown = createDefinition(), content?: string) {
  return compileSubstrateDefinition({
    sourcePath: 'substrates/adr.json',
    value,
    ...(content === undefined ? {} : { content }),
  });
}

describe('compileSubstrateDefinition', function describeCompiler() {
  it('compiles a strict definition into Quartz storage claim and write validator', () => {
    const result = compile();

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.substrate.storageClaim).toEqual({
      type: 'adr',
      folder: 'adr',
      identity: {
        strategy: 'numbered-threaded',
        minimumDigits: 4,
        displayTemplate: 'ADR {key}',
      },
    });
    const candidate = {
      id: '0001',
      type: 'adr',
      title: 'Use markdown',
    };
    expect(result.substrate.validateWrite(candidate)).toEqual({
      ok: true,
      entity: candidate,
    });
    expect(result.substrate.validateWrite({
      id: '0001',
      type: 'requirement',
      title: 'Wrong type',
    })).toMatchObject({
      ok: false,
      issues: [{ code: 'shape', path: '/type' }],
    });
  });

  it('rejects unknown definition fields and invalid identity variants', () => {
    const withUnknownField = {
      ...(createDefinition() as Record<string, unknown>),
      legacyAlias: true,
    };
    const unknownResult = compile(withUnknownField);
    expect(unknownResult).toMatchObject({
      ok: false,
      diagnostic: {
        sourcePath: 'substrates/adr.json',
        type: 'adr',
        issues: [{ code: 'shape' }],
      },
    });

    const withoutPrefix = {
      ...(createDefinition() as Record<string, unknown>),
      identity: {
        strategy: 'prefixed-number',
        minimumDigits: 4,
      },
    };
    expect(compile(withoutPrefix).ok).toBe(false);

    const numberedWithPrefix = {
      ...(createDefinition() as Record<string, unknown>),
      identity: {
        strategy: 'numbered',
        prefix: 'ADR',
      },
    };
    expect(compile(numberedWithPrefix).ok).toBe(false);
  });

  it.each([
    '/absolute',
    '../escape',
    'nested/../escape',
    String.raw`windows\path`,
    'trailing/',
    'substrates',
    'Substrates/private',
    'substrates/private',
    'control\u0000character',
  ])('rejects unsafe folder claim %s', (folder) => {
    const definition = {
      ...(createDefinition() as Record<string, unknown>),
      folder,
    };
    expect(compile(definition)).toMatchObject({
      ok: false,
      diagnostic: {
        issues: [{
          code: 'unsafe',
          path: '/folder',
        }],
      },
    });
  });

  it('requires canonical id, type, title, strict properties, and matching type const', () => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        type: { const: 'requirement' },
      },
      required: ['id', 'type'],
      additionalProperties: true,
    };
    const result = compile(createDefinition(schema));

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: '/schema/additionalProperties',
          }),
          expect.objectContaining({
            path: '/schema/properties/type/const',
          }),
          expect.objectContaining({
            message: 'canonical write schema must require title',
          }),
        ]),
      },
    });
  });

  it('executes Draft 2020-12 conditionals, dependencies, and uniqueItems', () => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        mode: { type: 'string', enum: ['simple', 'reviewed'] },
        reviewer: { type: 'string', maxLength: 80 },
        tags: {
          type: 'array',
          items: { type: 'string', maxLength: 40 },
          maxItems: 10,
          uniqueItems: true,
        },
      },
      dependentRequired: {
        reviewer: ['mode'],
      },
      if: {
        properties: {
          mode: { const: 'reviewed' },
        },
        required: ['mode'],
      },
      then: {
        required: ['reviewer'],
      },
    };
    const result = compile(createDefinition(schema));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const candidate = {
      id: '0001',
      type: 'adr',
      title: 'Reviewed',
      mode: 'reviewed',
      reviewer: 'Goga',
      tags: ['schema', 'runtime'],
    };
    expect(result.substrate.validateWrite(candidate)).toEqual({
      ok: true,
      entity: candidate,
    });
    expect(result.substrate.validateWrite({
      id: '0001',
      type: 'adr',
      title: 'Missing reviewer',
      mode: 'reviewed',
    }).ok).toBe(false);
    expect(result.substrate.validateWrite({
      id: '0001',
      type: 'adr',
      title: 'Duplicate tags',
      tags: ['schema', 'schema'],
    }).ok).toBe(false);
  });

  it('does not coerce values, remove unknown fields, or mutate candidates', () => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        status: {
          type: 'string',
          enum: ['intake', 'done'],
          default: 'intake',
        },
      },
    };
    const result = compile(createDefinition(schema));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const candidate = {
      id: 1,
      type: 'adr',
      title: 'Candidate',
      unknown: true,
    };

    expect(result.substrate.validateWrite(candidate).ok).toBe(false);
    expect(candidate).toEqual({
      id: 1,
      type: 'adr',
      title: 'Candidate',
      unknown: true,
    });

    const withoutDefault = {
      id: '0001',
      type: 'adr',
      title: 'No mutation',
    };
    expect(result.substrate.validateWrite(withoutDefault)).toEqual({
      ok: true,
      entity: withoutDefault,
    });
    expect(withoutDefault).not.toHaveProperty('status');
  });

  it('compiles semantic intents into resolved names, bindings, and mechanics', () => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        content: { type: 'string', maxLength: 2_000 },
        status: {
          type: 'string',
          enum: ['proposed', 'accepted', 'superseded'],
        },
        evidence: {
          type: 'array',
          items: { type: 'string', maxLength: 200 },
          maxItems: 20,
        },
        enabled: { type: 'boolean' },
        supersedes: {
          type: 'array',
          items: { type: 'string', maxLength: 200 },
          maxItems: 20,
        },
      },
    };
    const result = compile({
      ...(createDefinition(schema) as Record<string, unknown>),
      workflow: {
        field: 'status',
        initial: ['proposed'],
        terminal: ['superseded'],
        transitions: [
          {
            name: 'accept',
            from: ['proposed'],
            to: 'accepted',
          },
          {
            name: 'supersede',
            from: ['accepted'],
            to: 'superseded',
          },
        ],
      },
      relations: {
        supersedes: {
          targets: ['adr'],
          cardinality: 'many',
        },
      },
      intents: [
        {
          verb: 'propose',
          operation: 'create',
          description: 'Propose one ADR.',
          requiredInputs: ['title', 'content'],
          defaults: { status: 'proposed' },
        },
        {
          verb: 'accept',
          operation: 'transition',
          description: 'Accept one ADR.',
          requiredInputs: ['id'],
          optionalInputs: ['evidence'],
          transition: 'accept',
        },
        {
          verb: 'pause',
          operation: 'set-field',
          description: 'Pause one ADR-shaped fixture.',
          requiredInputs: ['id'],
          field: 'enabled',
          value: false,
        },
        {
          verb: 'supersede',
          operation: 'relate-and-transition',
          description: 'Supersede an older ADR.',
          requiredInputs: ['replacement_id', 'superseded_id'],
          relation: 'supersedes',
          sourceInput: 'replacement_id',
          targetInput: 'superseded_id',
          targetTransition: 'supersede',
        },
      ],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.substrate.intents.map(function intentName(intent) {
      return intent.toolName;
    })).toEqual([
      'backlog_propose_adr',
      'backlog_accept_adr',
      'backlog_pause_adr',
      'backlog_supersede_adr',
    ]);
    expect(result.substrate.intents[0]?.operation).toEqual({
      kind: 'create',
      fields: [
        { input: 'title', field: 'title' },
        { input: 'content', field: 'content' },
      ],
      fixedFields: { status: 'proposed' },
    });
    expect(result.substrate.intents[1]?.operation).toEqual({
      kind: 'transition',
      subjectInput: 'id',
      transition: {
        field: 'status',
        from: ['proposed'],
        to: 'accepted',
      },
      fields: [{ input: 'evidence', field: 'evidence' }],
    });
    expect(result.substrate.intents[2]?.operation).toEqual({
      kind: 'set-field',
      subjectInput: 'id',
      field: 'enabled',
      value: false,
    });
    expect(result.substrate.intents[3]?.operation).toEqual({
      kind: 'relate-and-transition',
      sourceInput: 'replacement_id',
      targetInput: 'superseded_id',
      relation: {
        field: 'supersedes',
        cardinality: 'many',
        targets: ['adr'],
      },
      targetTransition: {
        field: 'status',
        from: ['accepted'],
        to: 'superseded',
      },
    });
    expect(result.substrate.intents[0]?.intentInputSchema.parse({
      title: 'Use compiled intents',
      content: 'Decision body',
    })).toEqual({
      title: 'Use compiled intents',
      content: 'Decision body',
    });
    expect(result.substrate.intents[3]?.intentInputSchema.safeParse({
      replacement_id: '0002',
      superseded_id: '0001',
      extra: true,
    }).success).toBe(false);
  });

  it('lowers exposed defaults into input parsing and keeps fixed fields unoverrideable', () => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        status: {
          type: 'string',
          enum: ['intake', 'done'],
        },
        compliance: {
          type: 'string',
          enum: ['unchecked', 'satisfied'],
        },
      },
    };
    const result = compile({
      ...(createDefinition(schema) as Record<string, unknown>),
      intents: [{
        verb: 'capture',
        toolName: 'backlog_capture_requirement',
        operation: 'create',
        description: 'Capture one requirement.',
        requiredInputs: ['title'],
        optionalInputs: ['status'],
        defaults: {
          status: 'intake',
          compliance: 'unchecked',
        },
      }],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const intent = result.substrate.intents[0];
    expect(intent?.intentInputSchema.parse({ title: 'Protect the vision' })).toEqual({
      title: 'Protect the vision',
      status: 'intake',
    });
    expect(intent?.operation).toEqual({
      kind: 'create',
      fields: [
        { input: 'title', field: 'title' },
        { input: 'status', field: 'status' },
      ],
      fixedFields: {
        compliance: 'unchecked',
      },
    });
  });

  it('rejects generated tool names that exceed the explicit name contract', () => {
    const type = `a${'b'.repeat(63)}`;
    const verb = `v${'e'.repeat(79)}`;
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        type: { const: type },
      },
    };
    const result = compile({
      ...(createDefinition(schema) as Record<string, unknown>),
      type,
      intents: [{
        verb,
        operation: 'create',
        description: 'Generated name is too long.',
        requiredInputs: ['title'],
      }],
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: '/intents/0/toolName',
            message: expect.stringContaining('at most 128 characters'),
          }),
        ]),
      },
    });
  });

  it('resolves local relation item schemas and rejects non-string target arrays', () => {
    const relationIntent = {
      verb: 'link',
      operation: 'append-relation',
      description: 'Link two ADRs.',
      requiredInputs: ['source_id', 'target_id'],
      relation: 'links',
      sourceInput: 'source_id',
      targetInput: 'target_id',
    };
    const relation = {
      links: {
        targets: ['adr'],
        cardinality: 'many',
      },
    };
    const referencedSchema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        links: { $ref: '#/$defs/linkList' },
      },
      $defs: {
        linkList: {
          anyOf: [
            {
              type: 'array',
              items: { $ref: '#/$defs/entityId' },
              maxItems: 20,
            },
            { type: 'null' },
          ],
        },
        entityId: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
        },
      },
    };
    expect(compile({
      ...(createDefinition(referencedSchema) as Record<string, unknown>),
      relations: relation,
      intents: [relationIntent],
    })).toMatchObject({ ok: true });

    const numericSchema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        links: {
          type: 'array',
          items: { type: 'number' },
          maxItems: 20,
        },
      },
    };
    expect(compile({
      ...(createDefinition(numericSchema) as Record<string, unknown>),
      relations: relation,
      intents: [relationIntent],
    })).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: '/relations/links/cardinality',
            message: expect.stringContaining('array of string entity IDs'),
          }),
        ]),
      },
    });
  });

  it('compiles field-resolved search, get, and wakeup disclosure plans', () => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        content: { type: 'string', maxLength: 2_000 },
        status: {
          type: 'string',
          enum: ['proposed', 'accepted'],
        },
        implements: {
          type: 'array',
          items: { type: 'string', maxLength: 200 },
          maxItems: 20,
        },
      },
    };
    const result = compile({
      ...(createDefinition(schema) as Record<string, unknown>),
      workflow: {
        field: 'status',
        initial: ['proposed'],
        transitions: [{
          name: 'accept',
          from: ['proposed'],
          to: 'accepted',
        }],
      },
      relations: {
        implements: {
          targets: ['requirement', 'task'],
          cardinality: 'many',
          inverse: 'implemented_by',
        },
      },
      disclosure: {
        search: {
          enabled: true,
          fields: ['title', 'content', 'status'],
        },
        get: {
          context: true,
          groupByRole: true,
          relations: ['implements'],
        },
        wakeup: {
          section: 'decisions',
          includeStatuses: ['proposed'],
          limit: 5,
          projection: ['id', 'title', 'status'],
        },
      },
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.substrate.disclosure).toEqual({
      search: {
        fields: ['title', 'content', 'status'],
      },
      get: {
        relations: ['implements'],
      },
      wakeup: {
        section: 'decisions',
        includeStatuses: ['proposed'],
        limit: 5,
        projection: ['id', 'title', 'status'],
      },
    });
    expect(result.substrate.disclosureRelations).toEqual([{
      sourceType: 'adr',
      field: 'implements',
      cardinality: 'many',
      targets: ['requirement', 'task'],
      inverse: 'implemented_by',
    }]);
  });

  it.each([
    {
      name: 'unknown search field',
      disclosure: {
        search: {
          enabled: true,
          fields: ['unknown'],
        },
      },
      path: '/disclosure/search/fields',
    },
    {
      name: 'unknown get relation',
      disclosure: {
        get: {
          context: true,
          groupByRole: true,
          relations: ['unknown'],
        },
      },
      path: '/disclosure/get/relations',
    },
    {
      name: 'unknown wakeup status',
      workflow: {
        field: 'status',
        initial: ['open'],
        transitions: [],
      },
      disclosure: {
        wakeup: {
          section: 'decisions',
          includeStatuses: ['closed'],
          limit: 5,
          projection: ['id', 'title'],
        },
      },
      path: '/disclosure/wakeup/includeStatuses',
    },
  ])('rejects invalid disclosure plan: $name', ({ workflow, disclosure, path }) => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        status: { type: 'string', enum: ['open', 'closed'] },
      },
    };
    const result = compile({
      ...(createDefinition(schema) as Record<string, unknown>),
      ...(workflow === undefined ? {} : { workflow }),
      disclosure,
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path }),
        ]),
      },
    });
  });

  it('reserves resource for the generic document search sentinel', () => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        type: { const: 'resource' },
      },
    };
    expect(compile({
      ...(createDefinition(schema) as Record<string, unknown>),
      type: 'resource',
    })).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: '/type',
            message: expect.stringContaining('search sentinel'),
          }),
        ]),
      },
    });
  });

  it.each([
    {
      name: 'required and optional input overlap',
      intent: {
        verb: 'capture',
        operation: 'create',
        description: 'Invalid overlap.',
        requiredInputs: ['title'],
        optionalInputs: ['title'],
      },
    },
    {
      name: 'set-field targets workflow state',
      workflow: {
        field: 'status',
        initial: ['open'],
        transitions: [],
      },
      intent: {
        verb: 'pause',
        operation: 'set-field',
        description: 'Invalid workflow mutation.',
        requiredInputs: ['id'],
        field: 'status',
        value: 'done',
      },
    },
    {
      name: 'two-entity selectors are ambiguous',
      relations: {
        supersedes: {
          targets: ['adr'],
          cardinality: 'many',
        },
      },
      intent: {
        verb: 'supersede',
        operation: 'relate-and-transition',
        description: 'Invalid selectors.',
        requiredInputs: ['replacement_id'],
        relation: 'supersedes',
        sourceInput: 'replacement_id',
        targetInput: 'replacement_id',
        targetTransition: 'supersede',
      },
    },
    {
      name: 'required input also declares a default',
      intent: {
        verb: 'capture',
        operation: 'create',
        description: 'Invalid required default.',
        requiredInputs: ['title'],
        defaults: {
          title: 'Compiler-owned title',
        },
      },
    },
    {
      name: 'fixed field targets server-owned identity',
      intent: {
        verb: 'capture',
        operation: 'create',
        description: 'Invalid fixed identity.',
        requiredInputs: ['title'],
        defaults: {
          id: '0001',
        },
      },
    },
    {
      name: 'relation operation exposes a non-selector input',
      relations: {
        supersedes: {
          targets: ['adr'],
          cardinality: 'many',
        },
      },
      intent: {
        verb: 'link',
        operation: 'append-relation',
        description: 'Invalid relation payload.',
        requiredInputs: ['source_id', 'target_id'],
        optionalInputs: ['title'],
        relation: 'supersedes',
        sourceInput: 'source_id',
        targetInput: 'target_id',
      },
    },
  ])('rejects invalid intent plan: $name', ({ workflow, relations, intent }) => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        status: { type: 'string', enum: ['open', 'done'] },
        supersedes: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10,
        },
      },
    };
    const result = compile({
      ...(createDefinition(schema) as Record<string, unknown>),
      ...(workflow === undefined ? {} : { workflow }),
      ...(relations === undefined ? {} : { relations }),
      intents: [intent],
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining('/intents/0') }),
        ]),
      },
    });
  });

  it('allows resolved local definitions and rejects remote, unresolved, and cyclic refs', () => {
    const localSchema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        title: { $ref: '#/$defs/title' },
      },
      $defs: {
        title: { type: 'string', minLength: 1, maxLength: 300 },
      },
    };
    expect(compile(createDefinition(localSchema)).ok).toBe(true);

    const remoteSchema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        title: { $ref: 'https://example.com/title.json' },
      },
    };
    expect(compile(createDefinition(remoteSchema))).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'unsupported' }),
        ]),
      },
    });

    const unresolvedSchema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        title: { $ref: '#/$defs/missing' },
      },
    };
    expect(compile(createDefinition(unresolvedSchema))).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'compile' }),
        ]),
      },
    });

    const cyclicSchema = {
      ...BASE_SCHEMA,
      $defs: {
        first: { $ref: '#/$defs/second' },
        second: { $ref: '#/$defs/first' },
      },
    };
    expect(compile(createDefinition(cyclicSchema))).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'unsupported',
            message: 'cyclic local references are not supported',
          }),
        ]),
      },
    });
  });

  it('rejects unsupported keywords, unknown formats, and project-authored patterns', () => {
    const unsupportedSchema = {
      ...BASE_SCHEMA,
      $id: 'urn:project-schema',
      properties: {
        ...BASE_SCHEMA.properties,
        date: { type: 'string', format: 'email', maxLength: 100 },
        code: { type: 'string', pattern: '^(a+)+$', maxLength: 100 },
        ambiguous: { type: 'string', pattern: '^(a|aa)+$', maxLength: 100 },
        unbounded: { type: 'string', pattern: '^[a-z]+$' },
      },
    };
    const result = compile(createDefinition(unsupportedSchema));

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: '/schema/$id', code: 'unsupported' }),
          expect.objectContaining({ path: '/schema/properties/date/format' }),
          expect.objectContaining({
            path: '/schema/properties/code/pattern',
            code: 'unsupported',
          }),
          expect.objectContaining({
            path: '/schema/properties/ambiguous/pattern',
            code: 'unsupported',
          }),
        ]),
      },
    });
  });

  it('rejects oversized and deeply nested definitions before Ajv compilation', () => {
    expect(compile(createDefinition(), 'x'.repeat(256 * 1_024 + 1))).toMatchObject({
      ok: false,
      diagnostic: {
        issues: [{ code: 'limit', path: '/' }],
      },
    });

    const oversizedValue = createDefinition({
      ...BASE_SCHEMA,
      description: 'x'.repeat(256 * 1_024),
    });
    expect(compile(oversizedValue, '{}')).toMatchObject({
      ok: false,
      diagnostic: {
        issues: [{ code: 'limit', path: '/' }],
      },
    });

    let nested: Record<string, unknown> = { type: 'string', maxLength: 10 };
    for (let index = 0; index < 34; index += 1) {
      nested = { allOf: [nested] };
    }
    const deepSchema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        deep: nested,
      },
    };
    expect(compile(createDefinition(deepSchema))).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'limit' }),
        ]),
      },
    });
  });

  it('requires arrays, including uniqueItems arrays, to have a fixed maximum', () => {
    const schema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        tags: {
          type: 'array',
          items: { type: 'string', maxLength: 40 },
          uniqueItems: true,
        },
      },
    };
    expect(compile(createDefinition(schema))).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'unsafe',
            path: '/schema/properties/tags/maxItems',
          }),
        ]),
      },
    });

    const implicitArraySchema = {
      ...BASE_SCHEMA,
      properties: {
        ...BASE_SCHEMA.properties,
        tags: {
          items: { type: 'string', maxLength: 40 },
        },
      },
    };
    expect(compile(createDefinition(implicitArraySchema))).toMatchObject({
      ok: false,
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'unsafe',
            path: '/schema/properties/tags/maxItems',
          }),
        ]),
      },
    });
  });
});
