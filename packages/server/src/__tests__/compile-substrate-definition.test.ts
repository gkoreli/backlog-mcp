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
    expect(result.substrate.validateWrite({
      id: '0001',
      type: 'adr',
      title: 'Use markdown',
    })).toEqual({ ok: true });
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
    expect(result.substrate.validateWrite({
      id: '0001',
      type: 'adr',
      title: 'Reviewed',
      mode: 'reviewed',
      reviewer: 'Goga',
      tags: ['schema', 'runtime'],
    })).toEqual({ ok: true });
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
    expect(result.substrate.validateWrite(withoutDefault)).toEqual({ ok: true });
    expect(withoutDefault).not.toHaveProperty('status');
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
