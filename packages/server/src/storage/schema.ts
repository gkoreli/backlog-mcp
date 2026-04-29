/**
 * schema.ts — Server-only factory for creating entities.
 *
 * Validation authority: shared `EntitySchema` (discriminated union of all
 * substrate schemas). Factory assembles a plain object with the requested
 * type, then `EntitySchema.parse()` verifies shape, applies substrate
 * defaults (e.g. Cron.enabled = true), and rejects cross-type field leakage.
 *
 * Types and ID utilities live in @backlog-mcp/shared.
 */
import {
  EntitySchema,
  EntityType,
  type Entity,
  type Reference,
} from '@backlog-mcp/shared';

export interface CreateTaskInput {
  id: string;
  title: string;
  description?: string;
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  references?: Reference[];
  // Type-specific fields — rejected at parse time when present on a
  // non-matching type. Callers that set these MUST also set a matching type.
  due_date?: string;
  content_type?: string;
  path?: string;
  schedule?: string;
  command?: string;
  enabled?: boolean;
}

/**
 * Assemble an entity from inputs and validate against the substrate schema.
 * Throws ZodError if the input doesn't match the substrate for the given type.
 */
export function createTask(input: CreateTaskInput): Entity {
  const now = new Date().toISOString();
  const type = input.type ?? EntityType.Task;

  // Build a plain object. Keys set to undefined are kept out to avoid
  // tripping `.strict()` on substrates that don't permit them.
  const raw: Record<string, unknown> = {
    id: input.id,
    title: input.title,
    type,
    created_at: now,
    updated_at: now,
  };

  if (input.description !== undefined) raw.description = input.description;
  if (input.epic_id !== undefined) raw.epic_id = input.epic_id;
  if (input.parent_id !== undefined) raw.parent_id = input.parent_id;
  if (input.references?.length) raw.references = input.references;
  if (input.due_date !== undefined) raw.due_date = input.due_date;
  if (input.content_type !== undefined) raw.content_type = input.content_type;
  if (input.path !== undefined) raw.path = input.path;
  if (input.schedule !== undefined) raw.schedule = input.schedule;
  if (input.command !== undefined) raw.command = input.command;
  if (input.enabled !== undefined) raw.enabled = input.enabled;

  return EntitySchema.parse(raw);
}
