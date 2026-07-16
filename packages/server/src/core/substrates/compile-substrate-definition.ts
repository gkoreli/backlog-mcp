import { posix } from 'node:path';
import {
  RuntimeSubstrateDefinitionSchema,
  type RuntimeEntity,
  type RuntimeSubstrateDefinition,
} from '@backlog-mcp/shared';
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js';
import type { SubstrateStorageClaim } from '../../storage/substrate-storage-catalog.contract.js';
import type {
  CompileSubstrateDefinitionParams,
  CompileSubstrateDefinitionResult,
  SubstrateDefinitionIssue,
  SubstrateWriteValidationResult,
} from './types.js';
import { compileSubstrateIntents } from './compile-substrate-intents.js';
import { validateRuntimeJsonSchema } from './validate-runtime-json-schema.js';

const MAX_DECLARATION_BYTES = 256 * 1_024;
const RESERVED_DECLARATION_FOLDER = 'substrates';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '/';
  return `/${path.map(function escapeSegment(segment) {
    return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
  }).join('/')}`;
}

function recoverType(value: unknown): string | undefined {
  if (
    typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof value.type === 'string'
  ) {
    return value.type;
  }
  return undefined;
}

function declarationByteLength(params: CompileSubstrateDefinitionParams): number | undefined {
  try {
    const serializedValue = JSON.stringify(params.value);
    if (serializedValue === undefined) return undefined;
    const valueBytes = Buffer.byteLength(serializedValue, 'utf8');
    const contentBytes = params.content === undefined
      ? 0
      : Buffer.byteLength(params.content, 'utf8');
    return Math.max(valueBytes, contentBytes);
  } catch {
    return undefined;
  }
}

function validateDeclarationSize(
  params: CompileSubstrateDefinitionParams,
): SubstrateDefinitionIssue[] {
  const byteLength = declarationByteLength(params);
  if (byteLength === undefined) {
    return [{
      code: 'shape',
      path: '/',
      message: 'definition must be JSON-serializable',
    }];
  }
  if (byteLength > MAX_DECLARATION_BYTES) {
    return [{
      code: 'limit',
      path: '/',
      message: `definition may not exceed ${MAX_DECLARATION_BYTES} bytes`,
    }];
  }
  return [];
}

function validateFolder(folder: string): SubstrateDefinitionIssue[] {
  const segments = folder.split('/');
  const normalized = posix.normalize(folder);
  const invalid = folder.startsWith('/')
    || folder.includes('\\')
    || /[\u0000-\u001F\u007F]/u.test(folder)
    || folder.endsWith('/')
    || normalized !== folder
    || segments.some(function isUnsafeSegment(segment) {
      return segment === '' || segment === '.' || segment === '..';
    })
    || segments[0]?.toLowerCase() === RESERVED_DECLARATION_FOLDER;

  if (!invalid) return [];
  return [{
    code: 'unsafe',
    path: '/folder',
    message: 'folder must be a normalized relative POSIX path outside substrates/',
  }];
}

function validateCanonicalWriteSchema(
  definition: RuntimeSubstrateDefinition,
): SubstrateDefinitionIssue[] {
  const schema = definition.schema;
  const issues: SubstrateDefinitionIssue[] = [];
  if (schema.type !== 'object') {
    issues.push({
      code: 'shape',
      path: '/schema/type',
      message: 'canonical write schema must have type object',
    });
  }
  if (schema.additionalProperties !== false) {
    issues.push({
      code: 'shape',
      path: '/schema/additionalProperties',
      message: 'canonical write schema must reject additional properties',
    });
  }

  const properties = schema.properties;
  if (!isRecord(properties)) {
    issues.push({
      code: 'shape',
      path: '/schema/properties',
      message: 'canonical write schema must declare properties',
    });
  } else {
    const typeSchema = properties.type;
    if (!isRecord(typeSchema) || typeSchema.const !== definition.type) {
      issues.push({
        code: 'shape',
        path: '/schema/properties/type/const',
        message: `type const must equal ${definition.type}`,
      });
    }
  }

  const required = schema.required;
  const requiredKeys = Array.isArray(required)
    ? new Set(required.filter(function isString(value): value is string {
      return typeof value === 'string';
    }))
    : new Set<string>();
  for (const key of ['id', 'type', 'title']) {
    if (!requiredKeys.has(key)) {
      issues.push({
        code: 'shape',
        path: '/schema/required',
        message: `canonical write schema must require ${key}`,
      });
    }
  }
  return issues;
}

function prefixSchemaIssue(issue: SubstrateDefinitionIssue): SubstrateDefinitionIssue {
  return {
    ...issue,
    path: issue.path === '/' ? '/schema' : `/schema${issue.path}`,
  };
}

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    strictRequired: false,
    allErrors: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    $data: false,
    ownProperties: true,
    inlineRefs: false,
  });
  ajv.addFormat('date', {
    type: 'string',
    validate: function validateDate(value: string): boolean {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
    },
  });
  ajv.addFormat('date-time', {
    type: 'string',
    validate: function validateDateTime(value: string): boolean {
      return /^\d{4}-\d{2}-\d{2}T/u.test(value)
        && !Number.isNaN(Date.parse(value));
    },
  });
  return ajv;
}

function normalizeAjvIssues(errors: ErrorObject[] | null | undefined): SubstrateDefinitionIssue[] {
  if (!errors || errors.length === 0) {
    return [{
      code: 'shape',
      path: '/',
      message: 'candidate does not satisfy the substrate schema',
    }];
  }
  return errors.map(function normalizeError(error) {
    return {
      code: 'shape' as const,
      path: error.instancePath || '/',
      message: error.message ?? 'candidate does not satisfy the substrate schema',
    };
  });
}

function createWriteValidator(
  validate: ValidateFunction,
): (candidate: unknown) => SubstrateWriteValidationResult {
  return function validateWrite(candidate: unknown): SubstrateWriteValidationResult {
    if (validate(candidate)) {
      return {
        ok: true,
        entity: candidate as RuntimeEntity,
      };
    }
    return {
      ok: false,
      issues: normalizeAjvIssues(validate.errors),
    };
  };
}

function createStorageClaim(
  definition: RuntimeSubstrateDefinition,
): Readonly<SubstrateStorageClaim> {
  return {
    type: definition.type,
    folder: definition.folder,
    identity: { ...definition.identity },
  };
}

function failure(
  params: CompileSubstrateDefinitionParams,
  issues: SubstrateDefinitionIssue[],
): CompileSubstrateDefinitionResult {
  const type = recoverType(params.value);
  return {
    ok: false,
    diagnostic: {
      code: 'invalid-substrate-definition',
      sourcePath: params.sourcePath,
      ...(type === undefined ? {} : { type }),
      issues,
    },
  };
}

/** Compile one project-authored definition into a bounded canonical-write validator. */
export function compileSubstrateDefinition(
  params: CompileSubstrateDefinitionParams,
): CompileSubstrateDefinitionResult {
  const sizeIssues = validateDeclarationSize(params);
  if (sizeIssues.length > 0) return failure(params, sizeIssues);

  const parsed = RuntimeSubstrateDefinitionSchema.safeParse(params.value);
  if (!parsed.success) {
    return failure(
      params,
      parsed.error.issues.map(function normalizeZodIssue(issue) {
        return {
          code: 'shape' as const,
          path: issuePath(issue.path),
          message: issue.message,
        };
      }),
    );
  }

  const definition = parsed.data;
  const issues = [
    ...validateFolder(definition.folder),
    ...validateCanonicalWriteSchema(definition),
    ...validateRuntimeJsonSchema(definition.schema).map(prefixSchemaIssue),
  ];
  if (issues.length > 0) return failure(params, issues);

  const compiledIntents = compileSubstrateIntents(
    params.sourcePath,
    definition,
  );
  if (compiledIntents.issues.length > 0) {
    return failure(params, [...compiledIntents.issues]);
  }

  let validate: ValidateFunction;
  try {
    validate = createAjv().compile(definition.schema);
  } catch (error) {
    return failure(params, [{
      code: 'compile',
      path: '/schema',
      message: error instanceof Error ? error.message : 'schema compilation failed',
    }]);
  }

  return {
    ok: true,
    substrate: {
      kind: 'declarative',
      sourcePath: params.sourcePath,
      definition,
      intents: compiledIntents.intents,
      storageClaim: createStorageClaim(definition),
      validateWrite: createWriteValidator(validate),
    },
  };
}
