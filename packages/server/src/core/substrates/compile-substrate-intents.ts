import {
  type CompiledFieldBinding,
  type CompiledSubstrateIntent,
  type CompiledSubstrateRelation,
  type CompiledSubstrateTransition,
  type JsonScalar,
  type JsonValue,
  type RuntimeSubstrateDefinition,
  type RuntimeSubstrateIntentDefinition,
} from '@backlog-mcp/shared';
import { z } from 'zod';
import type { SubstrateDefinitionIssue } from './types.js';

const RESERVED_CREATE_FIELDS = new Set([
  'id',
  'type',
  'created_at',
  'updated_at',
]);
const MAX_TOOL_NAME_LENGTH = 128;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const SYNTHETIC_ID_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: 200,
} as const;

interface CompileSubstrateIntentsResult {
  intents: readonly CompiledSubstrateIntent[];
  issues: readonly SubstrateDefinitionIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(
  path: string,
  message: string,
  code: SubstrateDefinitionIssue['code'] = 'shape',
): SubstrateDefinitionIssue {
  return { code, path, message };
}

function intentPath(index: number, field?: string): string {
  return field === undefined
    ? `/intents/${index}`
    : `/intents/${index}/${field}`;
}

function defaultToolName(
  definition: RuntimeSubstrateDefinition,
  intent: RuntimeSubstrateIntentDefinition,
): string {
  return `backlog_${intent.verb}_${definition.type}`;
}

function canonicalProperties(
  definition: RuntimeSubstrateDefinition,
): Record<string, unknown> | undefined {
  const properties = definition.schema.properties;
  return isRecord(properties) ? properties : undefined;
}

function validateUniqueNames(
  values: readonly string[],
  path: string,
  label: string,
): SubstrateDefinitionIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size === 0) return [];
  return [issue(
    path,
    `${label} contains duplicate names: ${[...duplicates].sort().join(', ')}`,
  )];
}

function validateDefinitionVocabulary(
  definition: RuntimeSubstrateDefinition,
): SubstrateDefinitionIssue[] {
  const issues: SubstrateDefinitionIssue[] = [];
  const workflow = definition.workflow;
  if (workflow) {
    for (const [index, state] of [
      ...workflow.initial,
      ...(workflow.terminal ?? []),
    ].entries()) {
      issues.push(...validateCanonicalValues(
        definition,
        { [workflow.field]: state },
        `/workflow/states/${index}`,
      ));
    }
  }
  const transitions = definition.workflow?.transitions ?? [];
  issues.push(...validateUniqueNames(
    transitions.map(function transitionName(transition) {
      return transition.name;
    }),
    '/workflow/transitions',
    'workflow transitions',
  ));
  for (const [index, transition] of transitions.entries()) {
    for (const state of [...transition.from, transition.to]) {
      issues.push(...validateCanonicalValues(
        definition,
        { [workflow?.field ?? '']: state },
        `/workflow/transitions/${index}`,
      ));
    }
  }

  for (const [name, relation] of Object.entries(definition.relations ?? {})) {
    issues.push(...validateUniqueNames(
      relation.targets,
      `/relations/${name}/targets`,
      'relation targets',
    ));
  }

  const intents = definition.intents ?? [];
  issues.push(...validateUniqueNames(
    intents.map(function intentVerb(intent) {
      return intent.verb;
    }),
    '/intents',
    'intent verbs',
  ));
  issues.push(...validateUniqueNames(
    intents.map(function intentToolName(intent) {
      return intent.toolName ?? defaultToolName(definition, intent);
    }),
    '/intents',
    'intent tool names',
  ));
  for (const [index, intent] of intents.entries()) {
    const toolName = intent.toolName ?? defaultToolName(definition, intent);
    if (
      toolName.length > MAX_TOOL_NAME_LENGTH
      || !TOOL_NAME_PATTERN.test(toolName)
    ) {
      issues.push(issue(
        intentPath(index, 'toolName'),
        `compiled tool name must match ${TOOL_NAME_PATTERN} and contain at most ${MAX_TOOL_NAME_LENGTH} characters`,
      ));
    }
  }
  return issues;
}

function projectedObjectSchema(
  definition: RuntimeSubstrateDefinition,
  properties: Record<string, unknown>,
  required: readonly string[],
): Record<string, unknown> {
  const defs = definition.schema.$defs;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties,
    required: [...required],
    additionalProperties: false,
    ...(isRecord(defs) ? { $defs: defs } : {}),
  };
}

function compileInputSchema(
  definition: RuntimeSubstrateDefinition,
  intent: RuntimeSubstrateIntentDefinition,
  index: number,
  syntheticInputs: ReadonlySet<string>,
  inputDefaults: Readonly<Record<string, JsonValue>>,
): {
  schema?: z.ZodObject;
  issues: readonly SubstrateDefinitionIssue[];
} {
  const properties = canonicalProperties(definition);
  if (!properties) {
    return {
      issues: [issue('/schema/properties', 'canonical schema has no properties')],
    };
  }

  const requiredInputs = intent.requiredInputs;
  const optionalInputs = intent.optionalInputs ?? [];
  const allInputs = [...requiredInputs, ...optionalInputs];
  const issues = [
    ...validateUniqueNames(requiredInputs, intentPath(index, 'requiredInputs'), 'requiredInputs'),
    ...validateUniqueNames(optionalInputs, intentPath(index, 'optionalInputs'), 'optionalInputs'),
  ];
  const requiredSet = new Set(requiredInputs);
  for (const input of optionalInputs) {
    if (requiredSet.has(input)) {
      issues.push(issue(
        intentPath(index, 'optionalInputs'),
        `input ${input} cannot be both required and optional`,
      ));
    }
  }

  const inputProperties: Record<string, unknown> = {};
  for (const input of allInputs) {
    if (syntheticInputs.has(input)) {
      inputProperties[input] = SYNTHETIC_ID_SCHEMA;
      continue;
    }
    const property = properties[input];
    if (property === undefined) {
      issues.push(issue(
        intentPath(index, 'requiredInputs'),
        `input ${input} is not a canonical substrate field`,
      ));
      continue;
    }
    inputProperties[input] = property;
  }
  if (issues.length > 0) return { issues };

  try {
    const schema = z.fromJSONSchema(projectedObjectSchema(
      definition,
      inputProperties,
      requiredInputs,
    ));
    if (!(schema instanceof z.ZodObject)) {
      return {
        issues: [issue(
          intentPath(index),
          'compiled intent input schema must be an object',
          'compile',
        )],
      };
    }
    const shape = { ...schema.shape };
    for (const [input, value] of Object.entries(inputDefaults)) {
      const inputField = shape[input];
      if (inputField !== undefined) {
        shape[input] = inputField.default(value);
      }
    }
    return { schema: z.object(shape).strict(), issues: [] };
  } catch (error) {
    return {
      issues: [issue(
        intentPath(index),
        error instanceof Error
          ? error.message
          : 'intent input schema compilation failed',
        'compile',
      )],
    };
  }
}

function validateCanonicalValues(
  definition: RuntimeSubstrateDefinition,
  values: Readonly<Record<string, JsonValue>>,
  path: string,
): readonly SubstrateDefinitionIssue[] {
  const keys = Object.keys(values);
  if (keys.length === 0) return [];
  const properties = canonicalProperties(definition);
  if (!properties) {
    return [issue('/schema/properties', 'canonical schema has no properties')];
  }
  const selected: Record<string, unknown> = {};
  const issues: SubstrateDefinitionIssue[] = [];
  for (const key of keys) {
    if (RESERVED_CREATE_FIELDS.has(key)) {
      issues.push(issue(
        path,
        `cannot assign server-owned field ${key}`,
      ));
      continue;
    }
    const property = properties[key];
    if (property === undefined) {
      issues.push(issue(
        path,
        `${key} is not a canonical substrate field`,
      ));
      continue;
    }
    selected[key] = property;
  }
  if (issues.length > 0) return issues;

  try {
    const schema = z.fromJSONSchema(projectedObjectSchema(
      definition,
      selected,
      keys,
    ));
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      return [issue(
        path,
        parsed.error.issues[0]?.message
          ?? 'values do not satisfy canonical fields',
      )];
    }
  } catch (error) {
    return [issue(
      path,
      error instanceof Error ? error.message : 'value compilation failed',
      'compile',
    )];
  }
  return [];
}

function compileDefaults(
  definition: RuntimeSubstrateDefinition,
  intent: RuntimeSubstrateIntentDefinition,
  index: number,
): {
  fixedFields?: Readonly<Record<string, JsonValue>>;
  inputDefaults?: Readonly<Record<string, JsonValue>>;
  issues: readonly SubstrateDefinitionIssue[];
} {
  const defaults = (intent.defaults ?? {}) as Readonly<Record<string, JsonValue>>;
  const keys = Object.keys(defaults);
  if (keys.length === 0) {
    return { fixedFields: {}, inputDefaults: {}, issues: [] };
  }
  if (intent.operation !== 'create') {
    return {
      issues: [issue(
        intentPath(index, 'defaults'),
        'only create intents may declare defaults',
      )],
    };
  }
  const validationIssues = validateCanonicalValues(
    definition,
    defaults,
    intentPath(index, 'defaults'),
  );
  if (validationIssues.length > 0) return { issues: validationIssues };

  const inputs = new Set([
    ...intent.requiredInputs,
    ...(intent.optionalInputs ?? []),
  ]);
  const fixedFields: Record<string, JsonValue> = {};
  const inputDefaults: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (inputs.has(key)) {
      if (intent.requiredInputs.includes(key)) {
        return {
          issues: [issue(
            intentPath(index, 'defaults'),
            `required input ${key} cannot also declare a default`,
          )],
        };
      }
      inputDefaults[key] = value;
    } else {
      fixedFields[key] = value;
    }
  }
  return {
    fixedFields,
    inputDefaults,
    issues: [],
  };
}

function resolveTransition(
  definition: RuntimeSubstrateDefinition,
  name: string,
  path: string,
  satisfiedRelation?: string,
): {
  transition?: CompiledSubstrateTransition;
  issues: readonly SubstrateDefinitionIssue[];
} {
  const workflow = definition.workflow;
  if (!workflow) {
    return {
      issues: [issue(path, `transition ${name} requires a workflow declaration`)],
    };
  }
  const transition = workflow.transitions.find(function namedTransition(candidate) {
    return candidate.name === name;
  });
  if (!transition) {
    return {
      issues: [issue(path, `unknown workflow transition: ${name}`)],
    };
  }
  if (
    transition.requiresRelation !== undefined
    && transition.requiresRelation !== satisfiedRelation
  ) {
    return {
      issues: [issue(
        path,
        `transition ${name} requires relation ${transition.requiresRelation}`,
        'unsupported',
      )],
    };
  }
  const properties = canonicalProperties(definition);
  if (!properties || properties[workflow.field] === undefined) {
    return {
      issues: [issue(
        '/workflow/field',
        `workflow field ${workflow.field} is not a canonical substrate field`,
      )],
    };
  }
  return {
    transition: {
      field: workflow.field,
      from: transition.from,
      to: transition.to,
    },
    issues: [],
  };
}

function resolveRelation(
  definition: RuntimeSubstrateDefinition,
  name: string,
  path: string,
): {
  relation?: CompiledSubstrateRelation;
  issues: readonly SubstrateDefinitionIssue[];
} {
  const relation = definition.relations?.[name];
  if (!relation) {
    return {
      issues: [issue(path, `unknown substrate relation: ${name}`)],
    };
  }
  const properties = canonicalProperties(definition);
  if (!properties || properties[name] === undefined) {
    return {
      issues: [issue(
        `/relations/${name}`,
        `relation field ${name} is not a canonical substrate field`,
      )],
    };
  }
  const property = properties[name];
  if (!jsonSchemaSupportsRelation(definition, property, relation.cardinality)) {
    const expectedShape = relation.cardinality === 'many'
      ? 'array of string entity IDs'
      : 'string entity ID';
    return {
      issues: [issue(
        `/relations/${name}/cardinality`,
        `${relation.cardinality} relation ${name} requires a canonical ${expectedShape} field`,
      )],
    };
  }
  return {
    relation: {
      field: name,
      cardinality: relation.cardinality,
      targets: relation.targets,
    },
    issues: [],
  };
}

function resolveLocalReference(
  definition: RuntimeSubstrateDefinition,
  value: Record<string, unknown>,
): unknown {
  const reference = value.$ref;
  if (typeof reference !== 'string') return value;
  const match = /^#\/\$defs\/((?:[^/~]|~[01])+)$/u.exec(reference);
  if (!match) return undefined;
  const encodedName = match[1];
  if (!encodedName) return undefined;
  const name = encodedName.replaceAll('~1', '/').replaceAll('~0', '~');
  const definitions = definition.schema.$defs;
  return isRecord(definitions) ? definitions[name] : undefined;
}

function jsonSchemaAllowsType(
  definition: RuntimeSubstrateDefinition,
  value: unknown,
  expected: string,
  visited: ReadonlySet<unknown> = new Set(),
): boolean {
  if (!isRecord(value)) return false;
  if (visited.has(value)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(value);
  if (value.$ref !== undefined) {
    return jsonSchemaAllowsType(
      definition,
      resolveLocalReference(definition, value),
      expected,
      nextVisited,
    );
  }
  const type = value.type;
  if (type === expected) return true;
  if (Array.isArray(type) && type.includes(expected)) return true;
  for (const unionKey of ['oneOf', 'anyOf'] as const) {
    const variants = value[unionKey];
    if (
      Array.isArray(variants)
      && variants.some(function variantAllowsType(variant) {
        return jsonSchemaAllowsType(
          definition,
          variant,
          expected,
          nextVisited,
        );
      })
    ) {
      return true;
    }
  }
  return false;
}

function jsonSchemaSupportsRelation(
  definition: RuntimeSubstrateDefinition,
  value: unknown,
  cardinality: CompiledSubstrateRelation['cardinality'],
  visited: ReadonlySet<unknown> = new Set(),
): boolean {
  if (!isRecord(value) || visited.has(value)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(value);
  if (value.$ref !== undefined) {
    return jsonSchemaSupportsRelation(
      definition,
      resolveLocalReference(definition, value),
      cardinality,
      nextVisited,
    );
  }
  for (const unionKey of ['oneOf', 'anyOf'] as const) {
    const variants = value[unionKey];
    if (
      Array.isArray(variants)
      && variants.some(function variantSupportsRelation(variant) {
        return jsonSchemaSupportsRelation(
          definition,
          variant,
          cardinality,
          nextVisited,
        );
      })
    ) {
      return true;
    }
  }
  if (cardinality !== 'many') {
    return jsonSchemaAllowsType(definition, value, 'string', visited);
  }
  return jsonSchemaAllowsType(definition, value, 'array', visited)
    && jsonSchemaAllowsType(definition, value.items, 'string', nextVisited);
}

function validateCreateInputs(
  intent: RuntimeSubstrateIntentDefinition,
  index: number,
): SubstrateDefinitionIssue[] {
  if (intent.operation !== 'create') return [];
  const issues: SubstrateDefinitionIssue[] = [];
  for (const input of [
    ...intent.requiredInputs,
    ...(intent.optionalInputs ?? []),
  ]) {
    if (RESERVED_CREATE_FIELDS.has(input)) {
      issues.push(issue(
        intentPath(index),
        `create intent cannot accept server-owned field ${input}`,
      ));
    }
  }
  return issues;
}

function singleEntitySyntheticInputs(
  intent: RuntimeSubstrateIntentDefinition,
  index: number,
): {
  inputs: ReadonlySet<string>;
  issues: readonly SubstrateDefinitionIssue[];
} {
  if (intent.operation === 'create') return { inputs: new Set(), issues: [] };
  if (
    intent.operation === 'relate'
    || intent.operation === 'append-relation'
    || intent.operation === 'relate-and-transition'
  ) {
    const issues: SubstrateDefinitionIssue[] = [];
    if (intent.sourceInput === intent.targetInput) {
      issues.push(issue(
        intentPath(index),
        'sourceInput and targetInput must be distinct',
      ));
    }
    const required = new Set(intent.requiredInputs);
    for (const input of [intent.sourceInput, intent.targetInput]) {
      if (!required.has(input)) {
        issues.push(issue(
          intentPath(index, 'requiredInputs'),
          `${input} must be a required input`,
        ));
      }
    }
    const selectors = new Set([intent.sourceInput, intent.targetInput]);
    const extraInputs = [
      ...intent.requiredInputs,
      ...(intent.optionalInputs ?? []),
    ].filter(function isNotSelector(input) {
      return !selectors.has(input);
    });
    if (extraInputs.length > 0) {
      issues.push(issue(
        intentPath(index),
        `relation intents do not support extra inputs: ${extraInputs.sort().join(', ')}`,
        'unsupported',
      ));
    }
    return {
      inputs: new Set([intent.sourceInput, intent.targetInput]),
      issues,
    };
  }

  if (!intent.requiredInputs.includes('id')) {
    return {
      inputs: new Set(['id']),
      issues: [issue(
        intentPath(index, 'requiredInputs'),
        'single-entity mutation intent must require id',
      )],
    };
  }
  if (
    intent.operation === 'set-field'
    && (
      intent.requiredInputs.length !== 1
      || (intent.optionalInputs?.length ?? 0) > 0
    )
  ) {
    return {
      inputs: new Set(['id']),
      issues: [issue(
        intentPath(index),
        'set-field intents accept only the id selector',
      )],
    };
  }
  return { inputs: new Set(['id']), issues: [] };
}

function compileFieldBindings(
  intent: RuntimeSubstrateIntentDefinition,
  excludedInputs: ReadonlySet<string>,
): readonly CompiledFieldBinding[] {
  return [
    ...intent.requiredInputs,
    ...(intent.optionalInputs ?? []),
  ]
    .filter(function isEntityField(input) {
      return !excludedInputs.has(input);
    })
    .map(function bindField(input) {
      return { input, field: input };
    });
}

function compileOperation(
  definition: RuntimeSubstrateDefinition,
  intent: RuntimeSubstrateIntentDefinition,
  index: number,
  fixedFields: Readonly<Record<string, JsonValue>>,
): {
  operation?: CompiledSubstrateIntent['operation'];
  issues: readonly SubstrateDefinitionIssue[];
} {
  if (intent.operation === 'create') {
    return {
      operation: {
        kind: 'create',
        fields: compileFieldBindings(intent, new Set()),
        fixedFields,
      },
      issues: [],
    };
  }
  if (intent.operation === 'transition') {
    const resolved = resolveTransition(
      definition,
      intent.transition,
      intentPath(index, 'transition'),
    );
    return resolved.transition === undefined
      ? { issues: resolved.issues }
      : {
        operation: {
          kind: 'transition',
          subjectInput: 'id',
          transition: resolved.transition,
          fields: compileFieldBindings(intent, new Set(['id'])),
        },
        issues: [],
      };
  }
  if (intent.operation === 'set-field') {
    const properties = canonicalProperties(definition);
    const disallowed = RESERVED_CREATE_FIELDS.has(intent.field)
      || definition.workflow?.field === intent.field
      || definition.relations?.[intent.field] !== undefined;
    if (disallowed || !properties || properties[intent.field] === undefined) {
      return {
        issues: [issue(
          intentPath(index, 'field'),
          `set-field cannot assign ${intent.field}`,
        )],
      };
    }
    const validation = validateCanonicalValues(
      definition,
      { [intent.field]: intent.value },
      intentPath(index, 'value'),
    );
    if (validation.length > 0) return { issues: validation };
    return {
      operation: {
        kind: 'set-field',
        subjectInput: 'id',
        field: intent.field,
        value: intent.value,
      },
      issues: [],
    };
  }

  const resolvedRelation = resolveRelation(
    definition,
    intent.relation,
    intentPath(index, 'relation'),
  );
  if (!resolvedRelation.relation) return { issues: resolvedRelation.issues };

  if (
    intent.operation === 'append-relation'
    && resolvedRelation.relation.cardinality !== 'many'
  ) {
    return {
      issues: [issue(
        intentPath(index, 'relation'),
        'append-relation requires a many-cardinality relation',
      )],
    };
  }
  if (intent.operation === 'relate' || intent.operation === 'append-relation') {
    return {
      operation: {
        kind: intent.operation,
        sourceInput: intent.sourceInput,
        targetInput: intent.targetInput,
        relation: resolvedRelation.relation,
      },
      issues: [],
    };
  }

  if (resolvedRelation.relation.targets.some(function isOtherType(target) {
    return target !== definition.type;
  })) {
    return {
      issues: [issue(
        intentPath(index, 'targetTransition'),
        'version one can resolve target transitions only for self-type relations',
        'unsupported',
      )],
    };
  }
  const targetTransition = resolveTransition(
    definition,
    intent.targetTransition,
    intentPath(index, 'targetTransition'),
    definition.relations?.[intent.relation]?.inverse ?? intent.relation,
  );
  if (!targetTransition.transition) return { issues: targetTransition.issues };
  return {
    operation: {
      kind: 'relate-and-transition',
      sourceInput: intent.sourceInput,
      targetInput: intent.targetInput,
      relation: resolvedRelation.relation,
      targetTransition: targetTransition.transition,
    },
    issues: [],
  };
}

/** Compile explicit semantic intents into resolved, transport-safe contracts. */
export function compileSubstrateIntents(
  sourcePath: string,
  definition: RuntimeSubstrateDefinition,
): CompileSubstrateIntentsResult {
  const declarationIssues = validateDefinitionVocabulary(definition);
  if (declarationIssues.length > 0) {
    return { intents: [], issues: declarationIssues };
  }

  const compiled: CompiledSubstrateIntent[] = [];
  const issues: SubstrateDefinitionIssue[] = [];
  for (const [index, intent] of (definition.intents ?? []).entries()) {
    const synthetic = singleEntitySyntheticInputs(intent, index);
    const createIssues = validateCreateInputs(intent, index);
    const defaults = compileDefaults(definition, intent, index);
    const input = compileInputSchema(
      definition,
      intent,
      index,
      synthetic.inputs,
      defaults.inputDefaults ?? {},
    );
    const operation = compileOperation(
      definition,
      intent,
      index,
      defaults.fixedFields ?? {},
    );
    const intentIssues = [
      ...synthetic.issues,
      ...createIssues,
      ...input.issues,
      ...defaults.issues,
      ...operation.issues,
    ];
    if (
      intentIssues.length > 0
      || input.schema === undefined
      || defaults.fixedFields === undefined
      || defaults.inputDefaults === undefined
      || operation.operation === undefined
    ) {
      issues.push(...intentIssues);
      continue;
    }
    compiled.push({
      sourcePath,
      substrateType: definition.type,
      verb: intent.verb,
      toolName: intent.toolName ?? defaultToolName(definition, intent),
      description: intent.description,
      intentInputSchema: input.schema,
      operation: operation.operation,
    });
  }
  return {
    intents: issues.length === 0 ? compiled : [],
    issues,
  };
}
