/**
 * Core function return types — transport-agnostic.
 * MCP and CLI wrappers format these for their respective outputs.
 */
import type { Entity, Status, EntityType, Reference } from '@backlog-mcp/shared';

// ── List ──

export interface ListParams {
  status?: Status[];
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  query?: string;
  counts?: boolean;
  limit?: number;
}

export interface ListResult {
  tasks: Array<{
    id: string;
    title: string;
    status: Status;
    type: string;
    parent_id?: string;
  }>;
  counts?: {
    total_tasks: number;
    total_epics: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  };
}

// ── Get ──

export interface GetResult {
  content: string;
}

// ── Create ──

export interface CreateParams {
  title: string;
  description?: string;
  source_path?: string;
  type?: EntityType;
  epic_id?: string;
  parent_id?: string;
  references?: Reference[];
}

export interface CreateResult {
  id: string;
}

// ── Update ──

export interface UpdateParams {
  title?: string;
  status?: Status;
  epic_id?: string | null;
  parent_id?: string | null;
  blocked_reason?: string[];
  evidence?: string[];
  references?: Reference[];
  due_date?: string | null;
  content_type?: string | null;
}

export interface UpdateResult {
  id: string;
}

// ── Delete ──

export interface DeleteResult {
  id: string;
}

// ── Search ──

export interface SearchParams {
  query: string;
  types?: Array<'task' | 'epic' | 'resource'>;
  status?: Status[];
  parent_id?: string;
  sort?: 'relevant' | 'recent';
  limit?: number;
  include_content?: boolean;
  include_scores?: boolean;
}

export interface SearchResultItem {
  id: string;
  title: string;
  type: string;
  status?: Status;
  parent_id?: string;
  path?: string;
  snippet?: string;
  matched_fields?: string[];
  score?: number;
  description?: string;
  content?: string;
}

export interface SearchResult {
  results: SearchResultItem[];
  total: number;
  query: string;
  search_mode: string;
}

// ── Write (edit body) ──

export interface WriteParams {
  id: string;
  operation: {
    type: 'str_replace' | 'insert' | 'append';
    old_str?: string;
    new_str?: string;
    insert_line?: number;
  };
}

export interface WriteResult {
  success: boolean;
  message?: string;
  error?: string;
}

// ── Errors ──

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Not found: ${id}`);
    this.name = 'NotFoundError';
  }
}
