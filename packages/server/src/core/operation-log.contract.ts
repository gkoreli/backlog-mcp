/**
 * Types for operation logging.
 */

export interface Actor {
  type: 'user' | 'agent';
  name: string;
  delegatedBy?: string;
  taskContext?: string;
}

export type Mutation = 'create' | 'update' | 'delete' | 'resource-edit';

export interface MutationAttribution {
  tool: string;
  mutation: Mutation;
}

export interface OperationEntry {
  ts: string;
  tool: string;
  /** Optional only for operation entries written before ADR 0106.5. */
  mutation?: Mutation;
  params: Record<string, unknown>;
  result: unknown;
  resourceId?: string;
  /** Display filename for write_resource ops (e.g. "TASK-0001.md"). Computed by enrichment layer. */
  targetFilename?: string;
  actor: Actor;
}

export interface OperationFilter {
  taskId?: string;
  date?: string; // YYYY-MM-DD - filter by local date
  tzOffset?: number; // Client timezone offset in minutes (e.g. -480 for PST)
  limit?: number;
}

/**
 * Shared interface for operation logging — implemented by both
 * OperationLogger (local/JSONL) and D1OperationLog (cloud/D1).
 * Keeps hono-app.ts and middleware.ts environment-agnostic.
 */
export interface IOperationLog {
  append(entry: OperationEntry): void;
  query(filter?: OperationFilter): Promise<OperationEntry[]>;
  countForTask(taskId: string): Promise<number>;
}
