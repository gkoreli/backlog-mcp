import type { SubstrateDefinitionIssue } from './types.js';
import safeRegex from 'safe-regex2';

const DRAFT_2020_12_URI = 'https://json-schema.org/draft/2020-12/schema';
const MAX_ARRAY_ITEMS = 1_000;
const MAX_CONTAINER_ITEMS = 256;
const MAX_DEPTH = 32;
const MAX_ENUM_VALUES = 64;
const MAX_NODES = 4_096;
const MAX_PATTERN_LENGTH = 256;
const MAX_PATTERN_INPUT_LENGTH = 512;
const MAX_SCHEMA_BRANCHES = 16;

const ALLOWED_FORMATS = new Set(['date', 'date-time']);
const ALLOWED_KEYWORDS = new Set([
  '$defs',
  '$ref',
  '$schema',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'dependentRequired',
  'description',
  'else',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'if',
  'items',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'oneOf',
  'pattern',
  'properties',
  'readOnly',
  'required',
  'then',
  'title',
  'type',
  'uniqueItems',
]);
const SCHEMA_MAP_KEYWORDS = new Set(['$defs', 'properties']);
const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf']);
const SCHEMA_SINGLE_KEYWORDS = new Set([
  'additionalProperties',
  'else',
  'if',
  'items',
  'then',
]);
const PRIMITIVE_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);

interface SchemaVisit {
  depth: number;
  path: string;
  schema: unknown;
  scopePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeJsonPointer(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function childPath(path: string, segment: string): string {
  return `${path}/${escapeJsonPointer(segment)}`;
}

function addIssue(
  issues: SubstrateDefinitionIssue[],
  code: SubstrateDefinitionIssue['code'],
  path: string,
  message: string,
): void {
  issues.push({ code, path: path || '/', message });
}

function isPrimitive(value: unknown): boolean {
  return value === null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string';
}

function isUnsafePattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return true;
  const hasLookaround = /\(\?(?:[=!]|<[=!])/u.test(pattern);
  const hasBackReference = /\\[1-9]/u.test(pattern);
  const hasQuantifiedAlternation = /\((?:[^()[\]\\]|\\.|\[[^\]]*\])*\|(?:[^()[\]\\]|\\.|\[[^\]]*\])*\)[+*{]/u
    .test(pattern);
  return hasLookaround
    || hasBackReference
    || hasQuantifiedAlternation
    || !safeRegex(pattern);
}

function validatePattern(
  schema: Record<string, unknown>,
  path: string,
  issues: SubstrateDefinitionIssue[],
): void {
  if (schema.pattern === undefined) return;
  const patternPath = childPath(path, 'pattern');
  if (typeof schema.pattern !== 'string') {
    addIssue(issues, 'shape', patternPath, 'pattern must be a string');
    return;
  }
  if (isUnsafePattern(schema.pattern)) {
    addIssue(issues, 'unsafe', patternPath, 'pattern is invalid or outside the safe subset');
  }
  if (
    typeof schema.maxLength !== 'number'
    || !Number.isInteger(schema.maxLength)
    || schema.maxLength < 0
    || schema.maxLength > MAX_PATTERN_INPUT_LENGTH
  ) {
    addIssue(
      issues,
      'unsafe',
      childPath(path, 'maxLength'),
      `patterned strings require maxLength at most ${MAX_PATTERN_INPUT_LENGTH}`,
    );
  }
}

function validateEnum(
  schema: Record<string, unknown>,
  path: string,
  issues: SubstrateDefinitionIssue[],
): void {
  if (schema.enum === undefined) return;
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
    addIssue(issues, 'shape', childPath(path, 'enum'), 'enum must be a non-empty array');
    return;
  }
  if (schema.enum.length > MAX_ENUM_VALUES) {
    addIssue(
      issues,
      'limit',
      childPath(path, 'enum'),
      `enum may contain at most ${MAX_ENUM_VALUES} values`,
    );
  }
  if (!schema.enum.every(isPrimitive)) {
    addIssue(issues, 'unsupported', childPath(path, 'enum'), 'enum values must be primitives');
  }
}

function validateReference(
  schema: Record<string, unknown>,
  path: string,
  scopePath: string,
  issues: SubstrateDefinitionIssue[],
  references: Map<string, Set<string>>,
): void {
  if (schema.$ref === undefined) return;
  const refPath = childPath(path, '$ref');
  if (
    typeof schema.$ref !== 'string'
    || !/^#\/\$defs\/(?:[^/~]|~[01])+$/u.test(schema.$ref)
  ) {
    addIssue(
      issues,
      'unsupported',
      refPath,
      'only direct local #/$defs/<name> references are supported',
    );
    return;
  }

  const targetPath = schema.$ref.slice(1);
  const targets = references.get(scopePath) ?? new Set<string>();
  targets.add(targetPath);
  references.set(scopePath, targets);
}

function validateScalarKeywords(
  schema: Record<string, unknown>,
  path: string,
  issues: SubstrateDefinitionIssue[],
): void {
  if (schema.$schema !== undefined && schema.$schema !== DRAFT_2020_12_URI) {
    addIssue(
      issues,
      'unsupported',
      childPath(path, '$schema'),
      `only ${DRAFT_2020_12_URI} is supported`,
    );
  }
  if (schema.type !== undefined && (
    typeof schema.type !== 'string'
    || !PRIMITIVE_TYPES.has(schema.type)
  )) {
    addIssue(issues, 'unsupported', childPath(path, 'type'), 'type must be one JSON primitive type');
  }
  if (
    schema.format !== undefined
    && (typeof schema.format !== 'string' || !ALLOWED_FORMATS.has(schema.format))
  ) {
    addIssue(issues, 'unsupported', childPath(path, 'format'), 'format is not allowlisted');
  }
  validatePattern(schema, path, issues);
  validateEnum(schema, path, issues);
}

function validateArrayBounds(
  schema: Record<string, unknown>,
  path: string,
  issues: SubstrateDefinitionIssue[],
): void {
  if (schema.type !== 'array' && schema.uniqueItems !== true) return;
  if (
    typeof schema.maxItems !== 'number'
    || !Number.isInteger(schema.maxItems)
    || schema.maxItems < 0
    || schema.maxItems > MAX_ARRAY_ITEMS
  ) {
    addIssue(
      issues,
      'unsafe',
      childPath(path, 'maxItems'),
      `arrays require maxItems at most ${MAX_ARRAY_ITEMS}`,
    );
  }
}

function pushSchemaMaps(
  visit: SchemaVisit,
  schema: Record<string, unknown>,
  stack: SchemaVisit[],
  issues: SubstrateDefinitionIssue[],
  knownPaths: Set<string>,
): void {
  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const value = schema[keyword];
    if (value === undefined) continue;
    const keywordPath = childPath(visit.path, keyword);
    if (!isRecord(value)) {
      addIssue(issues, 'shape', keywordPath, `${keyword} must be an object`);
      continue;
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_CONTAINER_ITEMS) {
      addIssue(
        issues,
        'limit',
        keywordPath,
        `${keyword} may contain at most ${MAX_CONTAINER_ITEMS} entries`,
      );
    }
    for (const [name, childSchema] of entries) {
      const path = childPath(keywordPath, name);
      const scopePath = keyword === '$defs' ? path : visit.scopePath;
      knownPaths.add(path);
      stack.push({
        schema: childSchema,
        path,
        scopePath,
        depth: visit.depth + 1,
      });
    }
  }
}

function pushSchemaArrays(
  visit: SchemaVisit,
  schema: Record<string, unknown>,
  stack: SchemaVisit[],
  issues: SubstrateDefinitionIssue[],
  knownPaths: Set<string>,
): void {
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    const value = schema[keyword];
    if (value === undefined) continue;
    const keywordPath = childPath(visit.path, keyword);
    if (!Array.isArray(value) || value.length === 0) {
      addIssue(issues, 'shape', keywordPath, `${keyword} must be a non-empty array`);
      continue;
    }
    if (value.length > MAX_SCHEMA_BRANCHES) {
      addIssue(
        issues,
        'limit',
        keywordPath,
        `${keyword} may contain at most ${MAX_SCHEMA_BRANCHES} branches`,
      );
    }
    value.forEach(function pushBranch(childSchema, index) {
      const path = childPath(keywordPath, String(index));
      knownPaths.add(path);
      stack.push({
        schema: childSchema,
        path,
        scopePath: visit.scopePath,
        depth: visit.depth + 1,
      });
    });
  }
}

function pushSingleSchemas(
  visit: SchemaVisit,
  schema: Record<string, unknown>,
  stack: SchemaVisit[],
  issues: SubstrateDefinitionIssue[],
  knownPaths: Set<string>,
): void {
  for (const keyword of SCHEMA_SINGLE_KEYWORDS) {
    const value = schema[keyword];
    if (value === undefined || typeof value === 'boolean') continue;
    const path = childPath(visit.path, keyword);
    if (!isRecord(value)) {
      addIssue(issues, 'shape', path, `${keyword} must be a schema object or boolean`);
      continue;
    }
    knownPaths.add(path);
    stack.push({
      schema: value,
      path,
      scopePath: visit.scopePath,
      depth: visit.depth + 1,
    });
  }
}

function hasReferenceCycle(references: Map<string, Set<string>>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(path: string): boolean {
    if (visiting.has(path)) return true;
    if (visited.has(path)) return false;

    visiting.add(path);
    const targets = references.get(path);
    if (targets) {
      for (const target of targets) {
        if (visit(target)) return true;
      }
    }
    visiting.delete(path);
    visited.add(path);
    return false;
  }

  for (const path of references.keys()) {
    if (visit(path)) return true;
  }
  return false;
}

/** Validate the bounded JSON Schema subset accepted for runtime write validators. */
export function validateRuntimeJsonSchema(
  value: Record<string, unknown>,
): SubstrateDefinitionIssue[] {
  const issues: SubstrateDefinitionIssue[] = [];
  const knownPaths = new Set<string>(['']);
  const references = new Map<string, Set<string>>();
  const stack: SchemaVisit[] = [{
    schema: value,
    path: '',
    scopePath: '',
    depth: 0,
  }];
  let visitedNodes = 0;

  while (stack.length > 0) {
    const visit = stack.pop();
    if (!visit) break;
    visitedNodes += 1;
    if (visitedNodes > MAX_NODES) {
      addIssue(issues, 'limit', visit.path, `schema may contain at most ${MAX_NODES} nodes`);
      break;
    }
    if (visit.depth > MAX_DEPTH) {
      addIssue(issues, 'limit', visit.path, `schema nesting may not exceed ${MAX_DEPTH}`);
      continue;
    }
    if (!isRecord(visit.schema)) {
      addIssue(issues, 'shape', visit.path, 'schema nodes must be objects');
      continue;
    }

    const entries = Object.entries(visit.schema);
    if (entries.length > MAX_CONTAINER_ITEMS) {
      addIssue(
        issues,
        'limit',
        visit.path,
        `schema objects may contain at most ${MAX_CONTAINER_ITEMS} keywords`,
      );
    }
    for (const keyword of Object.keys(visit.schema)) {
      if (!ALLOWED_KEYWORDS.has(keyword)) {
        addIssue(
          issues,
          keyword.startsWith('$') ? 'unsupported' : 'shape',
          childPath(visit.path, keyword),
          `keyword ${keyword} is not supported`,
        );
      }
    }

    validateScalarKeywords(visit.schema, visit.path, issues);
    validateArrayBounds(visit.schema, visit.path, issues);
    validateReference(
      visit.schema,
      visit.path,
      visit.scopePath,
      issues,
      references,
    );
    pushSchemaMaps(visit, visit.schema, stack, issues, knownPaths);
    pushSchemaArrays(visit, visit.schema, stack, issues, knownPaths);
    pushSingleSchemas(visit, visit.schema, stack, issues, knownPaths);
  }

  for (const targets of references.values()) {
    for (const target of targets) {
      if (!knownPaths.has(target)) {
        addIssue(issues, 'compile', target, 'local reference does not resolve');
      }
    }
  }
  if (hasReferenceCycle(references)) {
    addIssue(issues, 'unsupported', '/$ref', 'cyclic local references are not supported');
  }

  return issues;
}
