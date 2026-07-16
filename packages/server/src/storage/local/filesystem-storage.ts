import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type {
  AnyEntity,
  Entity,
  EntityType,
  Status,
  SubstrateType,
} from '@backlog-mcp/shared';
import {
  EntitySchema,
  TYPE_PREFIXES,
  isValidEntityId,
} from '@backlog-mcp/shared';
import type { StorageAdapter, ListFilter } from '../storage-adapter.js';
import { paths } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';

// On-disk directory name. DO NOT change this string — existing data lives in
// `<backlogDataDir>/tasks/`; renaming the value orphans every stored entity.
// The symbol is generic ("entities") but the value stays `tasks` for back-compat.
const ENTITIES_DIR = 'tasks';

/**
 * Pure file I/O for entity storage (all substrate types). No search knowledge.
 * The local/filesystem implementation of {@link StorageAdapter}.
 */
export class FilesystemStorage implements StorageAdapter {
  private get entitiesPath(): string {
    return join(paths.backlogDataDir, ENTITIES_DIR);
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private entityFilePath(id: string): string {
    return join(this.entitiesPath, `${id}.md`);
  }

  private entityToMarkdown(entity: AnyEntity): string {
    const { content, ...frontmatter } = entity;
    return matter.stringify(content || '', frontmatter);
  }

  private markdownToEntity(raw: string): Entity {
    // gray-matter returns the markdown body under its own `content` key; alias
    // it to `body` so it doesn't shadow the entity's `content` field below.
    const { data, content: body } = matter(raw);
    return { ...data, content: body.trim() } as Entity;
  }

  getFilePath(id: string): string | null {
    const path = this.entityFilePath(id);
    return existsSync(path) ? path : null;
  }

  *iterateEntities(): Generator<Entity> {
    if (existsSync(this.entitiesPath)) {
      for (const file of readdirSync(this.entitiesPath).filter(f => f.endsWith('.md'))) {
        const filePath = join(this.entitiesPath, file);
        try {
          const entity = this.markdownToEntity(readFileSync(filePath, 'utf-8'));
          if (!entity.id) continue;
          yield entity;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn('Malformed entity file', { file, error: errorMessage });
          }
          continue;
        }
      }
    }
  }

  get(id: string): Entity | undefined {
    const path = this.entityFilePath(id);
    if (existsSync(path)) {
      return this.markdownToEntity(readFileSync(path, 'utf-8'));
    }
    return undefined;
  }

  getMarkdown(id: string): string | null {
    const path = this.entityFilePath(id);
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
    return null;
  }

  list(filter?: ListFilter): Entity[] {
    const { status, type, parent_id, limit = 20 } = filter ?? {};
    let entities = Array.from(this.iterateEntities());

    if (status) entities = entities.filter(t => t.status !== undefined && status.includes(t.status));
    if (type) entities = entities.filter(t => (t.type ?? 'task') === type);
    if (parent_id) entities = entities.filter(t => t.parent_id === parent_id);

    return entities
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit);
  }

  add(candidate: AnyEntity): Entity {
    const entity = EntitySchema.parse(candidate);
    this.ensureDir(this.entitiesPath);
    writeFileSync(this.entityFilePath(entity.id), this.entityToMarkdown(entity));
    return entity;
  }

  save(candidate: AnyEntity): Entity {
    const entity = EntitySchema.parse(candidate);
    if (!isValidEntityId(entity.id)) {
      throw new Error(`Cannot save entity with invalid id: ${String(entity.id)}`);
    }
    this.ensureDir(this.entitiesPath);
    writeFileSync(this.entityFilePath(entity.id), this.entityToMarkdown(entity));
    return entity;
  }

  delete(id: string): boolean {
    const path = this.entityFilePath(id);
    if (existsSync(path)) {
      unlinkSync(path);
      
      // Delete associated resources if they exist
      const resourcesPath = join(paths.backlogDataDir, 'resources', id);
      if (existsSync(resourcesPath)) {
        rmSync(resourcesPath, { recursive: true, force: true });
      }
      
      return true;
    }
    return false;
  }

  counts(): { total_tasks: number; total_epics: number; by_status: Record<Status, number>; by_type: Record<string, number> } {
    const by_status: Record<Status, number> = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
    };

    const by_type: Record<string, number> = {};
    let total_tasks = 0;
    let total_epics = 0;

    for (const entity of this.iterateEntities()) {
      if (entity.status !== undefined) by_status[entity.status]++;
      const type = entity.type ?? 'task';
      by_type[type] = (by_type[type] || 0) + 1;
      if (type === 'epic') {
        total_epics++;
      } else {
        total_tasks++;
      }
    }

    return { total_tasks, total_epics, by_status, by_type };
  }

  getMaxId(type: SubstrateType): number {
    const prefix = TYPE_PREFIXES[type as EntityType];
    if (prefix === undefined) {
      throw new Error(`No legacy storage identity for substrate type: ${type}`);
    }
    const pattern = new RegExp(`^${prefix}-(\\d{4,})\\.md$`);
    let maxNum = 0;

    if (existsSync(this.entitiesPath)) {
      for (const file of readdirSync(this.entitiesPath)) {
        const match = pattern.exec(file);
        if (match?.[1]) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    }

    return maxNum;
  }
}
