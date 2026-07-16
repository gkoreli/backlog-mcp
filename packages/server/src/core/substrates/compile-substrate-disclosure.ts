import type {
  CompiledDisclosureRelation,
  CompiledSubstrateDisclosure,
  JsonScalar,
  RuntimeSubstrateDefinition,
} from '@backlog-mcp/shared';
import type { SubstrateDefinitionIssue } from './types.js';

interface CompileSubstrateDisclosureResult {
  disclosure: CompiledSubstrateDisclosure;
  relations: readonly CompiledDisclosureRelation[];
  issues: readonly SubstrateDefinitionIssue[];
}

function issue(path: string, message: string): SubstrateDefinitionIssue {
  return { code: 'shape', path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalProperties(
  definition: RuntimeSubstrateDefinition,
): Readonly<Record<string, unknown>> {
  return isRecord(definition.schema.properties)
    ? definition.schema.properties
    : {};
}

function duplicateIssues(
  values: readonly string[],
  path: string,
): SubstrateDefinitionIssue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates.size === 0
    ? []
    : [issue(
      path,
      `contains duplicate names: ${[...duplicates].sort().join(', ')}`,
    )];
}

function validateFields(
  definition: RuntimeSubstrateDefinition,
  fields: readonly string[],
  path: string,
): SubstrateDefinitionIssue[] {
  const properties = canonicalProperties(definition);
  const issues = duplicateIssues(fields, path);
  for (const field of fields) {
    if (properties[field] === undefined) {
      issues.push(issue(path, `${field} is not a canonical substrate field`));
    }
  }
  return issues;
}

function scalarKey(value: JsonScalar): string {
  return JSON.stringify(value);
}

function validateWakeupStatuses(
  definition: RuntimeSubstrateDefinition,
  statuses: readonly JsonScalar[],
): SubstrateDefinitionIssue[] {
  if (statuses.length === 0) return [];
  const workflow = definition.workflow;
  if (!workflow) {
    return [issue(
      '/disclosure/wakeup/includeStatuses',
      'includeStatuses requires a workflow declaration',
    )];
  }
  const declared = new Set([
    ...workflow.initial,
    ...(workflow.terminal ?? []),
    ...workflow.transitions.flatMap(function transitionStates(transition) {
      return [...transition.from, transition.to];
    }),
  ].map(scalarKey));
  const issues: SubstrateDefinitionIssue[] = [];
  const seen = new Set<string>();
  for (const status of statuses) {
    const key = scalarKey(status);
    if (seen.has(key)) {
      issues.push(issue(
        '/disclosure/wakeup/includeStatuses',
        `contains duplicate status ${key}`,
      ));
    } else if (!declared.has(key)) {
      issues.push(issue(
        '/disclosure/wakeup/includeStatuses',
        `status ${key} is not declared by the workflow`,
      ));
    }
    seen.add(key);
  }
  return issues;
}

/**
 * Compile progressive-disclosure declarations into resolved registry data.
 *
 * The output contains field and relation names only after they have been
 * checked against the canonical schema, so retrieval/search consumers never
 * reopen project-authored declarations.
 */
export function compileSubstrateDisclosure(
  definition: RuntimeSubstrateDefinition,
): CompileSubstrateDisclosureResult {
  const source = definition.disclosure;
  if (!source) {
    return { disclosure: {}, relations: [], issues: [] };
  }

  const issues: SubstrateDefinitionIssue[] = [];
  const disclosure: {
    search?: CompiledSubstrateDisclosure['search'];
    recall?: CompiledSubstrateDisclosure['recall'];
    get?: CompiledSubstrateDisclosure['get'];
    wakeup?: CompiledSubstrateDisclosure['wakeup'];
  } = {};

  if (source.search?.enabled === true) {
    issues.push(...validateFields(
      definition,
      source.search.fields,
      '/disclosure/search/fields',
    ));
    disclosure.search = { fields: source.search.fields };
  }

  if (source.recall?.enabled === true) {
    issues.push(...validateFields(
      definition,
      source.recall.projection,
      '/disclosure/recall/projection',
    ));
    disclosure.recall = { projection: source.recall.projection };
  }

  const relations: CompiledDisclosureRelation[] = [];
  if (source.get?.context === true) {
    issues.push(...duplicateIssues(
      source.get.relations,
      '/disclosure/get/relations',
    ));
    for (const field of source.get.relations) {
      const relation = definition.relations?.[field];
      if (!relation) {
        issues.push(issue(
          '/disclosure/get/relations',
          `${field} is not a declared substrate relation`,
        ));
        continue;
      }
      relations.push({
        sourceType: definition.type,
        field,
        cardinality: relation.cardinality,
        targets: relation.targets,
        ...(relation.inverse === undefined ? {} : { inverse: relation.inverse }),
      });
    }
    disclosure.get = { relations: source.get.relations };
  }

  if (source.wakeup) {
    issues.push(...validateFields(
      definition,
      source.wakeup.projection,
      '/disclosure/wakeup/projection',
    ));
    const includeStatuses = source.wakeup.includeStatuses ?? [];
    issues.push(...validateWakeupStatuses(definition, includeStatuses));
    disclosure.wakeup = {
      section: source.wakeup.section,
      includeStatuses,
      limit: source.wakeup.limit,
      projection: source.wakeup.projection,
    };
  }

  return {
    disclosure: issues.length === 0 ? disclosure : {},
    relations: issues.length === 0 ? relations : [],
    issues,
  };
}
