/**
 * D1BacklogService — per-request service layer backed by D1Storage.
 *
 * This is the cloud counterpart of BacklogService (which is a filesystem singleton).
 * Unlike BacklogService, D1BacklogService is NOT a singleton — a new instance is
 * created for each incoming Worker request.
 *
 * ADR-0089 Phase 2: wire up the Cloudflare Worker MCP endpoint.
 */

import {
  EntitySchema,
  EntityType,
  STATUSES,
  type AnyEntity,
  type Entity,
  type Status,
  type SubstrateType,
} from '@backlog-mcp/shared';
import { D1Storage } from './d1-storage.js';
import type { IBacklogService } from '../backlog-service.contract.js';

export class D1BacklogService implements IBacklogService {
  private storage: D1Storage;

  constructor(db: any) {
    this.storage = new D1Storage(db);
  }

  async get(id: string): Promise<Entity | undefined> {
    return this.storage.get(id);
  }

  async getMarkdown(id: string): Promise<string | null> {
    return this.storage.getMarkdown(id);
  }

  async list(filter?: {
    status?: string[];
    type?: SubstrateType;
    parent_id?: string;
    query?: string;
    limit?: number;
  }): Promise<Entity[]> {
    const { query, ...storageFilter } = filter ?? {};
    const type = storageFilter.type;
    if (type !== undefined && !Object.values(EntityType).includes(type as EntityType)) {
      return [];
    }
    const allowedStatuses = new Set<string>(STATUSES);
    if (storageFilter.status?.some(function isUnknownStatus(status) {
      return !allowedStatuses.has(status);
    })) {
      return [];
    }
    const builtinFilter = {
      ...storageFilter,
      status: storageFilter.status as Status[] | undefined,
      type: type as EntityType | undefined,
    };
    if (query) {
      // Use FTS5 search in D1Storage
      return this.storage.search(query, builtinFilter.limit);
    }
    return this.storage.list(builtinFilter);
  }

  async add(candidate: AnyEntity): Promise<Entity> {
    const entity = EntitySchema.parse(candidate);
    await this.storage.add(entity);
    return entity;
  }

  async save(candidate: AnyEntity): Promise<Entity> {
    const entity = EntitySchema.parse(candidate);
    await this.storage.save(entity);
    return entity;
  }

  async delete(id: string): Promise<boolean> {
    return this.storage.delete(id);
  }

  async counts(): Promise<{
    total_tasks: number;
    total_epics: number;
    by_status: Record<Status, number>;
    by_type: Record<string, number>;
  }> {
    return this.storage.counts();
  }

  async getMaxId(type: SubstrateType = EntityType.Task): Promise<number> {
    if (!Object.values(EntityType).includes(type as EntityType)) {
      throw new Error(`D1 does not support runtime substrate type: ${type}`);
    }
    return this.storage.getMaxId(type as EntityType);
  }

  // Simplified searchUnified for cloud mode — returns task/epic entities only
  async searchUnified(
    query: string,
    options?: { limit?: number; status?: Status[] },
  ): Promise<Array<{ item: Entity; score: number; type: 'task' | 'epic' }>> {
    const results = await this.storage.search(query, options?.limit ?? 20);
    return results.map((task) => ({
      item: task,
      score: (task as any).score ?? 1,
      type: (task.type === 'epic' ? 'epic' : 'task') as 'task' | 'epic',
    }));
  }
}
