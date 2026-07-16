/**
 * Operation logger - thin orchestration layer.
 * Coordinates storage, resource ID extraction, and actor info.
 */

import { OperationStorage } from './storage.js';
import type { Actor, OperationEntry, OperationFilter, IOperationLog } from './types.js';

/**
 * Build an Actor from the current process environment.
 *
 * Called per-invocation (not module-load) so each CLI command or server
 * process sees the env at the time it runs, not at import time. The write
 * boundary (core functions) takes Actor as a parameter so attribution is
 * never ambient — see ADR 0094.
 */
export function envActor(): Actor {
  return {
    type: (process.env.BACKLOG_ACTOR_TYPE as 'user' | 'agent') || 'user',
    name: process.env.BACKLOG_ACTOR_NAME || process.env.USER || 'unknown',
    delegatedBy: process.env.BACKLOG_DELEGATED_BY,
    taskContext: process.env.BACKLOG_TASK_CONTEXT,
  };
}

export class OperationLogger implements IOperationLog {
  constructor(private readonly storage: OperationStorage) {}

  /** IOperationLog: append a pre-built entry directly. */
  append(entry: OperationEntry): void {
    this.storage.append(entry);
  }

  /** IOperationLog: async query (wraps synchronous storage). */
  async query(filter: OperationFilter = {}): Promise<OperationEntry[]> {
    return this.storage.query(filter);
  }

  /** IOperationLog: async count (wraps synchronous storage). */
  async countForTask(taskId: string): Promise<number> {
    return this.storage.countForTask(taskId);
  }

  /** @deprecated Use query() — kept for backward compat with existing callers. */
  read(options: OperationFilter = {}): OperationEntry[] {
    return this.storage.query(options);
  }
}

/**
 * Create a local operation logger backed by the requested JSONL path.
 */
export function createOperationLogger(logPath: string): OperationLogger {
  return new OperationLogger(new OperationStorage(logPath));
}

// Re-export types for convenience
export type { Actor, OperationEntry, OperationFilter } from './types.js';
