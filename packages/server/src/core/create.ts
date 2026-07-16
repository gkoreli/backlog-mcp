import {
  getSubstrate,
  nextEntityId,
  type SubstrateDefinition,
} from '@backlog-mcp/shared';
import { ZodError } from 'zod';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { shouldCaptureArtifact } from '../memory/capture-rules.js';
import { captureArtifact } from '../memory/capture.js';
import {
  asBuiltinEntity,
  isBuiltinSubstrateType,
  SubstrateWriteError,
} from './substrates/index.js';
import { ValidationError } from './types.js';
import type {
  CreateEntityParams,
  CreateResult,
  MutationAttribution,
  WriteContext,
} from './types.js';
import { formatZodError } from './zod-errors.js';
import { recordMutation } from './operation-log.js';
import { routeContainer } from './container-routing.js';
import { extractEntityIds } from './get-context/cross-reference-traversal.js';

function assignDefined(
  target: Record<string, unknown>,
  fields: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) target[key] = value;
  }
}

function normalizeWriteError(error: unknown): never {
  if (error instanceof SubstrateWriteError) {
    throw new ValidationError(error.message);
  }
  if (error instanceof ZodError) {
    throw new ValidationError(formatZodError(error));
  }
  throw error;
}

function entityRefs(params: CreateEntityParams): string[] {
  const referenceIds = (params.references ?? []).flatMap(function ids(reference) {
    return extractEntityIds(reference.url);
  });
  const fieldRefs = params.fields?.entity_refs;
  return [
    ...referenceIds,
    ...(Array.isArray(fieldRefs)
      ? fieldRefs.filter(function stringRef(value): value is string {
          return typeof value === 'string' && value.trim().length > 0;
        })
      : []),
  ];
}

async function referencedContainer(
  service: IBacklogService,
  params: CreateEntityParams,
): Promise<string | undefined> {
  const referencedId = entityRefs(params)[0];
  if (referencedId === undefined) return undefined;
  const referenced = await service.get(referencedId);
  if (referenced === undefined) return undefined;
  if (isBuiltinSubstrateType(referenced.type)) {
    const substrate = getSubstrate(referenced.type);
    if (substrate.structure.isContainer) return referenced.id;
  }
  return typeof referenced.parent_id === 'string'
    ? referenced.parent_id
    : undefined;
}

async function recentOperations(ctx: WriteContext) {
  try {
    return await ctx.operationLog.query({ limit: 20 });
  } catch {
    // Routing is a defaulting aid; journal read failure must not block writes.
    return [];
  }
}

/**
 * Create one entity through the service's active substrate registry.
 *
 * The generic core assembles open data and protects server-owned identity.
 * Canonical parsing happens once at storage; compiled built-ins retain their
 * Zod defaults while declarative substrates retain their own strict schema.
 */
export async function createEntity(
  service: IBacklogService,
  params: CreateEntityParams,
  ctx: WriteContext,
  attribution: MutationAttribution,
): Promise<CreateResult> {
  const {
    title,
    content,
    type,
    references,
    fields,
    schedule,
    command,
    enabled,
  } = params;
  const builtinSubstrate: SubstrateDefinition | undefined =
    isBuiltinSubstrateType(type) ? getSubstrate(type) : undefined;
  const intake = ctx.substrateRegistry?.getIntake(type)
    ?? builtinSubstrate?.intake;
  const acceptsParent = builtinSubstrate !== undefined
    || ctx.substrateRegistry?.acceptsParent(type) === true;
  const lowerRungsReachable = acceptsParent
    && params.parent_id === undefined
    && intake?.container !== 'required'
    && !(intake?.container === 'scope-root' && ctx.scopeRoot !== undefined);
  const [referenceParentId, operations] = lowerRungsReachable
    ? await Promise.all([
        referencedContainer(service, params),
        recentOperations(ctx),
      ])
    : [undefined, []];
  const route = routeContainer({
    acceptsParent,
    ...(params.parent_id === undefined
      ? {}
      : { explicitParentId: params.parent_id }),
    ...(intake === undefined ? {} : { intake }),
    ...(ctx.scopeRoot === undefined ? {} : { scopeRoot: ctx.scopeRoot }),
    ...(referenceParentId === undefined ? {} : { referenceParentId }),
    operations,
    actor: ctx.actor,
    now: new Date().toISOString(),
  });
  if (route.parentRequired) {
    throw new ValidationError(`${type} requires an explicit parent_id`);
  }
  const id = await allocateEntityId(service, type);
  const candidate: Record<string, unknown> = { ...(fields ?? {}) };
  assignDefined(candidate, {
    content,
    parent_id: route.parentId,
    references,
    schedule,
    command,
    enabled,
  });
  candidate.id = id;
  candidate.type = type;
  candidate.title = title;

  if (isBuiltinSubstrateType(type)) {
    const now = new Date().toISOString();
    candidate.created_at = now;
    candidate.updated_at = now;
  }

  let stored;
  try {
    stored = await service.add(candidate as {
      id: string;
      type: string;
      title: string;
      [field: string]: unknown;
    });
  } catch (error) {
    normalizeWriteError(error);
  }

  const builtin = asBuiltinEntity(stored);
  if (ctx.memoryComposer && builtin !== undefined && shouldCaptureArtifact(builtin)) {
    await captureArtifact(ctx.memoryComposer, builtin, ctx.actor);
  }

  const result: CreateResult = {
    id: stored.id,
    ...(route.parentId === undefined ? {} : { parent_id: route.parentId }),
    ...(route.routedBy === undefined ? {} : { routed_by: route.routedBy }),
  };
  const effectiveParams = route.parentId === undefined
    || params.parent_id !== undefined
    ? params
    : { ...params, parent_id: route.parentId };
  recordMutation(
    ctx,
    attribution,
    stored.id,
    effectiveParams as unknown as Record<string, unknown>,
    result,
  );
  return result;
}

async function allocateBuiltinId(
  service: IBacklogService,
  type: string,
): Promise<string> {
  if (!isBuiltinSubstrateType(type)) {
    throw new ValidationError(`Unknown substrate type: ${type}`);
  }
  return nextEntityId(await service.getMaxId(type), type);
}

async function allocateEntityId(
  service: IBacklogService,
  type: string,
): Promise<string> {
  if (service.allocateId === undefined) {
    return allocateBuiltinId(service, type);
  }
  try {
    return await service.allocateId(type);
  } catch (error) {
    if (error instanceof SubstrateWriteError) {
      throw new ValidationError(error.message);
    }
    if (
      error instanceof Error
      && error.message.startsWith('No storage claim for entity type:')
    ) {
      throw new ValidationError(`Unknown substrate type: ${type}`);
    }
    throw error;
  }
}
