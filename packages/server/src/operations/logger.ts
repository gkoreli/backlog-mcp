/**
 * Operation logger - thin orchestration layer.
 * Coordinates storage, resource ID extraction, and actor info.
 */

import {
  ambientAgentIdentity,
  type AmbientAgentIdentityOverrides,
} from '../storage/local/agent-identity.js';
import { OperationStorage } from './storage.js';
import type { Actor, OperationEntry, OperationFilter, IOperationLog } from './types.js';

/**
 * Build an Actor from the current process environment.
 *
 * Called per-invocation (not module-load) so each CLI command or server
 * process sees the env at the time it runs, not at import time. The write
 * boundary (core functions) takes Actor as a parameter so attribution is
 * never ambient — see ADR 0094.
 *
 * ADR 0119.1: the ambient agent identity resolves through the attribution
 * ladder — worktree config → BACKLOG_AGENT env → checkout config → user
 * config (`git config backlog.agent` at each scope; git rungs probed once
 * per process, cached). The value is an AGENT- doc id or a declared
 * principal (e.g. "aime:granite"). When every rung is absent, the actor
 * is exactly what it was before ADR 0119. Identity stays OPTIONAL,
 * modular, never forced (PROMPT 0003).
 */
export function envActor(overrides?: AmbientAgentIdentityOverrides): Actor {
  const env = overrides?.env ?? process.env;
  const base: Actor = {
    type: (env.BACKLOG_ACTOR_TYPE as 'user' | 'agent') || 'user',
    name: env.BACKLOG_ACTOR_NAME || env.USER || 'unknown',
    delegatedBy: env.BACKLOG_DELEGATED_BY,
    taskContext: env.BACKLOG_TASK_CONTEXT,
  };
  const agentIdentity = ambientAgentIdentity({
    ...overrides,
    env,
  });
  return agentIdentity ? asAgentActor(agentIdentity.value, base) : base;
}

/**
 * Overlay an explicit agent identity on a base actor (ADR 0119 R3).
 *
 * The identity becomes the journal's `actor.name` and downstream memory
 * provenance source; everything else about the base actor (delegation,
 * task context) is preserved. Callers pass the identity from `--as`, the
 * MCP write field, or the resolved attribution ladder (ADR 0119.1) —
 * attribution stays a parameter, never a lookup.
 */
export function asAgentActor(identity: string, base: Actor = envActor()): Actor {
  return { ...base, type: 'agent', name: identity };
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
