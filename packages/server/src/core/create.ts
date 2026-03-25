import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { EntityType } from '@backlog-mcp/shared';
import { nextEntityId } from '@backlog-mcp/shared';
import type { IBacklogService } from '../storage/service-types.js';
import { createTask } from '../storage/schema.js';
import type { CreateParams, CreateResult } from './types.js';

export function resolveSourcePath(sourcePath: string): string {
  const expanded = sourcePath.startsWith('~') ? sourcePath.replace('~', homedir()) : sourcePath;
  const resolved = resolve(expanded);
  const stat = statSync(resolved, { throwIfNoEntry: false });
  if (!stat) throw new Error(`File not found: ${sourcePath}`);
  if (!stat.isFile()) throw new Error(`Not a file: ${sourcePath}`);
  return readFileSync(resolved, 'utf-8');
}

export async function createItem(service: IBacklogService, params: CreateParams): Promise<CreateResult> {
  const { title, description, source_path, type, epic_id, parent_id, references } = params;

  if (description && source_path) {
    throw new Error('Cannot provide both description and source_path — use one or the other');
  }

  let resolvedDescription = description;
  if (source_path) {
    resolvedDescription = resolveSourcePath(source_path);
  }

  const resolvedParent = parent_id ?? epic_id;
  const id = nextEntityId(await service.getMaxId(type as EntityType), type as EntityType);
  const task = createTask({ id, title, description: resolvedDescription, type, parent_id: resolvedParent, references });
  if (epic_id && !parent_id) task.epic_id = epic_id;
  await service.add(task);
  return { id: task.id };
}
