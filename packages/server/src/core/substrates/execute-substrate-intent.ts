import { readEntityForWrite, saveEntityCommitted, withWriteWarnings } from '../entity-mutation.js';
import type { EntityPreimage, WriteWarning } from '../entity-mutation.contract.js';
import type {
  AnyEntity,
  CompiledFieldBinding,
  CompiledSubstrateIntent,
  CompiledSubstrateRelation,
  CompiledSubstrateTransition,
  JsonValue,
} from '@backlog-mcp/shared';
import { isDeepStrictEqual } from 'node:util';
import { createEntity } from '../create.js';
import { recordMutation } from '../operation-log.js';
import {
  NotFoundError,
  ValidationError,
  type MutationAttribution,
} from '../types.js';
import {
  stampUpdatePostimage,
  updateEntityPostimage,
} from '../update.js';
import type { IntentWriteValidatorPort } from './intent-registry.contract.js';
import {
  SubstrateIntentExecutionError,
  type ExecuteSubstrateIntentParams,
  type ExecuteSubstrateIntentResult,
} from './execute-substrate-intent.types.js';

function attribution(
  intent: CompiledSubstrateIntent,
  mutation: MutationAttribution['mutation'],
): MutationAttribution {
  return { tool: intent.toolName, mutation };
}

function requiredString(
  input: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = input[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`Intent input ${name} must be a non-empty string`);
  }
  return value;
}

function mappedFields(
  bindings: readonly CompiledFieldBinding[],
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const binding of bindings) {
    const value = input[binding.input];
    if (value !== undefined) fields[binding.field] = value;
  }
  return fields;
}

function includesValue(
  values: readonly JsonValue[],
  candidate: unknown,
): boolean {
  return values.some(value => value === candidate);
}

function entityField(entity: AnyEntity, field: string): unknown {
  return (entity as unknown as Readonly<Record<string, unknown>>)[field];
}

async function requireEntity(
  service: ExecuteSubstrateIntentParams['service'],
  id: string,
): Promise<EntityPreimage> {
  const preimage = await readEntityForWrite(service, id);
  if (preimage === undefined) throw new NotFoundError(id);
  return preimage;
}

function requireSubjectType(entity: AnyEntity, substrateType: string): void {
  if (entity.type !== substrateType) {
    throw new ValidationError(
      `Intent for ${substrateType} cannot mutate ${entity.id} (${entity.type})`,
    );
  }
}

function validatedPostimage(
  validator: IntentWriteValidatorPort,
  candidate: unknown,
): AnyEntity {
  const validation = validator.validateWrite(candidate);
  if (validation.ok) return validation.entity;
  const message = validation.issues
    .map(issue => `${issue.path}: ${issue.message}`)
    .join('; ');
  throw new ValidationError(`Intent postimage failed validation: ${message}`);
}

function transitionValue(
  entity: AnyEntity,
  transition: CompiledSubstrateTransition,
): { changed: boolean; value: JsonValue } {
  const current = entityField(entity, transition.field);
  if (current === transition.to) {
    return { changed: false, value: transition.to };
  }
  if (!includesValue(transition.from, current)) {
    throw new ValidationError(
      `Transition ${transition.field} cannot move from ${JSON.stringify(current)} to ${JSON.stringify(transition.to)}`,
    );
  }
  return { changed: true, value: transition.to };
}

function relationValue(
  entity: AnyEntity,
  targetId: string,
  relation: CompiledSubstrateRelation,
): { changed: boolean; value: string | string[] } {
  const current = entityField(entity, relation.field);
  if (relation.cardinality === 'many') {
    if (
      current !== undefined
      && (!Array.isArray(current) || current.some(value => typeof value !== 'string'))
    ) {
      throw new ValidationError(
        `Relation field ${relation.field} must contain string IDs`,
      );
    }
    const ids = current === undefined ? [] : [...current] as string[];
    return ids.includes(targetId)
      ? { changed: false, value: ids }
      : { changed: true, value: [...ids, targetId] };
  }

  if (current === targetId) return { changed: false, value: targetId };
  if (current !== undefined && current !== null) {
    throw new ValidationError(
      `Relation field ${relation.field} already points to ${JSON.stringify(current)}`,
    );
  }
  return { changed: true, value: targetId };
}

function createParams(
  intent: CompiledSubstrateIntent,
  input: Readonly<Record<string, unknown>>,
): Parameters<typeof createEntity>[1] {
  if (intent.operation.kind !== 'create') {
    throw new ValidationError('Expected a compiled create intent');
  }
  const fields: Record<string, unknown> = {
    ...mappedFields(intent.operation.fields, input),
    ...intent.operation.fixedFields,
  };
  const title = fields.title;
  if (typeof title !== 'string' || title.length === 0) {
    throw new ValidationError('Create intent must resolve a non-empty title');
  }
  delete fields.title;
  // Routing reads the core parameter, before the field bag is persisted.
  const parentId = fields.parent_id;
  if (parentId !== undefined && typeof parentId !== 'string') {
    throw new ValidationError('Create intent parent_id must be a string');
  }
  delete fields.parent_id;

  return {
    title,
    type: intent.substrateType,
    ...(parentId === undefined ? {} : { parent_id: parentId }),
    fields,
  };
}

async function executeCreate(
  params: ExecuteSubstrateIntentParams,
): Promise<ExecuteSubstrateIntentResult> {
  const result = await createEntity(
    params.service,
    createParams(params.intent, params.input),
    params.context,
    attribution(params.intent, 'create'),
  );
  return withWriteWarnings({ ids: [result.id], changed: true }, result.warnings);
}

async function executeTransition(
  params: ExecuteSubstrateIntentParams,
): Promise<ExecuteSubstrateIntentResult> {
  if (params.intent.operation.kind !== 'transition') {
    throw new ValidationError('Expected a compiled transition intent');
  }
  const operation = params.intent.operation;
  const id = requiredString(params.input, operation.subjectInput);
  const preimage = await requireEntity(params.service, id);
  const entity = preimage.entity;
  requireSubjectType(entity, params.intent.substrateType);
  const transition = transitionValue(entity, operation.transition);
  const fields = mappedFields(operation.fields, params.input);
  fields[operation.transition.field] = transition.value;
  const hasFieldChange = Object.entries(fields).some(
    ([field, value]) => !isDeepStrictEqual(entityField(entity, field), value),
  );
  if (!transition.changed && !hasFieldChange) {
    return { ids: [id], changed: false };
  }
  const postimage = validatedPostimage(params.validator, {
    ...entity,
    ...fields,
  });
  const result = await updateEntityPostimage(
    params.service,
    entity,
    postimage,
    fields,
    params.context,
    attribution(params.intent, 'update'),
    preimage,
  );
  return withWriteWarnings({ ids: [id], changed: true }, result.warnings);
}

async function executeSetField(
  params: ExecuteSubstrateIntentParams,
): Promise<ExecuteSubstrateIntentResult> {
  if (params.intent.operation.kind !== 'set-field') {
    throw new ValidationError('Expected a compiled set-field intent');
  }
  const operation = params.intent.operation;
  const id = requiredString(params.input, operation.subjectInput);
  const preimage = await requireEntity(params.service, id);
  const entity = preimage.entity;
  requireSubjectType(entity, params.intent.substrateType);
  if (entityField(entity, operation.field) === operation.value) {
    return { ids: [id], changed: false };
  }
  const postimage = validatedPostimage(params.validator, {
    ...entity,
    [operation.field]: operation.value,
  });
  const result = await updateEntityPostimage(
    params.service,
    entity,
    postimage,
    { [operation.field]: operation.value },
    params.context,
    attribution(params.intent, 'update'),
    preimage,
  );
  return withWriteWarnings({ ids: [id], changed: true }, result.warnings);
}

async function executeRelateAndTransition(
  params: ExecuteSubstrateIntentParams,
): Promise<ExecuteSubstrateIntentResult> {
  if (params.intent.operation.kind !== 'relate-and-transition') {
    throw new ValidationError('Expected a compiled relate-and-transition intent');
  }
  const operation = params.intent.operation;
  const sourceId = requiredString(params.input, operation.sourceInput);
  const targetId = requiredString(params.input, operation.targetInput);
  if (sourceId === targetId) {
    throw new ValidationError('Relation source and target must be different entities');
  }

  const [sourcePreimage, targetPreimage] = await Promise.all([
    requireEntity(params.service, sourceId),
    requireEntity(params.service, targetId),
  ]);
  const source = sourcePreimage.entity;
  const target = targetPreimage.entity;
  requireSubjectType(source, params.intent.substrateType);
  if (!operation.relation.targets.includes(target.type)) {
    throw new ValidationError(
      `Relation ${operation.relation.field} cannot target substrate ${target.type}`,
    );
  }

  const relation = relationValue(source, targetId, operation.relation);
  const transition = transitionValue(target, operation.targetTransition);
  const updatedAt = new Date().toISOString();
  const advanceTimestamp = params.intent.sourcePath.startsWith('builtin:');
  const sourcePostimage = validatedPostimage(
    params.validator,
    stampUpdatePostimage(source, {
      ...source,
      [operation.relation.field]: relation.value,
    } as AnyEntity, { advanceTimestamp, updatedAt }),
  );
  const targetPostimage = validatedPostimage(
    params.validator,
    stampUpdatePostimage(target, {
      ...target,
      [operation.targetTransition.field]: transition.value,
    } as AnyEntity, { advanceTimestamp, updatedAt }),
  );

  if (!relation.changed && !transition.changed) {
    return { ids: [sourceId, targetId], changed: false };
  }

  let sourceAttempted = false;
  let targetAttempted = false;
  let writtenSource: EntityPreimage = { entity: sourcePostimage };
  let writtenTarget: EntityPreimage = { entity: targetPostimage };
  const warnings: WriteWarning[] = [];
  try {
    if (relation.changed) {
      sourceAttempted = params.service.saveCommitted === undefined;
      const committed = await saveEntityCommitted(params.service, sourcePostimage, { expected: sourcePreimage });
      sourceAttempted = true;
      writtenSource = committed.preimage ?? { entity: committed.value };
      warnings.push(...(committed.warnings ?? []));
    }
    if (transition.changed) {
      targetAttempted = params.service.saveCommitted === undefined;
      const committed = await saveEntityCommitted(params.service, targetPostimage, { expected: targetPreimage });
      targetAttempted = true;
      writtenTarget = committed.preimage ?? { entity: committed.value };
      warnings.push(...(committed.warnings ?? []));
    }
  } catch (error) {
    const compensationErrors: unknown[] = [];
    try {
      if (targetAttempted) await saveEntityCommitted(params.service, target, { expected: writtenTarget });
    } catch (targetCompensationError) {
      compensationErrors.push(targetCompensationError);
    }
    try {
      if (sourceAttempted) await saveEntityCommitted(params.service, source, { expected: writtenSource });
    } catch (sourceCompensationError) {
      compensationErrors.push(sourceCompensationError);
    }
    if (compensationErrors.length > 0) {
      throw new SubstrateIntentExecutionError(
        `Intent ${params.intent.toolName} partially failed and compensation failed`,
        'partial_failure',
        [sourceId, targetId],
        { mutationError: error, compensationErrors },
        false,
      );
    }
    throw new SubstrateIntentExecutionError(
      `Intent ${params.intent.toolName} failed; attempted writes were compensated`,
      'compensated-failure',
      [sourceId, targetId],
      error,
      true,
    );
  }

  const result = withWriteWarnings({ ids: [sourceId, targetId], changed: true }, warnings);
  const journalWarnings = recordMutation(
    params.context,
    attribution(params.intent, 'update'),
    sourceId,
    { ...params.input },
    result,
  );
  return withWriteWarnings(result, journalWarnings);
}

/** Execute one compiler-resolved semantic mutation without reopening declarations. */
export async function executeSubstrateIntent(
  params: ExecuteSubstrateIntentParams,
): Promise<ExecuteSubstrateIntentResult> {
  switch (params.intent.operation.kind) {
    case 'create':
      return executeCreate(params);
    case 'transition':
      return executeTransition(params);
    case 'set-field':
      return executeSetField(params);
    case 'relate-and-transition':
      return executeRelateAndTransition(params);
    case 'relate':
    case 'append-relation':
      throw new ValidationError(
        `Intent operation ${params.intent.operation.kind} is not executable in ADR 0106.5 initial-16 scope`,
      );
  }
}
