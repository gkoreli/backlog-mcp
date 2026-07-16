import { EntityType, nextEntityId } from '@backlog-mcp/shared';
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
import type { CreateParams, CreateResult, WriteContext } from './types.js';
import { formatZodError } from './zod-errors.js';
import { recordMutation } from './operation-log.js';

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

/**
 * Create one entity through the service's active substrate registry.
 *
 * The generic core assembles open data and protects server-owned identity.
 * Canonical parsing happens once at storage; compiled built-ins retain their
 * Zod defaults while declarative substrates retain their own strict schema.
 */
export async function createItem(
  service: IBacklogService,
  params: CreateParams,
  ctx: WriteContext,
): Promise<CreateResult> {
  const {
    title,
    content,
    type,
    parent_id,
    references,
    fields,
    schedule,
    command,
    enabled,
  } = params;
  const resolvedType = type ?? EntityType.Task;
  const id = await allocateEntityId(service, resolvedType);
  const candidate: Record<string, unknown> = { ...(fields ?? {}) };
  assignDefined(candidate, {
    content,
    parent_id,
    references,
    schedule,
    command,
    enabled,
  });
  candidate.id = id;
  candidate.type = resolvedType;
  candidate.title = title;

  if (isBuiltinSubstrateType(resolvedType)) {
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

  const result: CreateResult = { id: stored.id };
  recordMutation(ctx, 'backlog_create', params as unknown as Record<string, unknown>, result);
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
