import type {
  AnyEntity,
  CompiledSubstrateIntent,
} from '@backlog-mcp/shared';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
  executeSubstrateIntent,
  SubstrateIntentExecutionError,
  type IntentWriteValidatorPort,
} from '../core/substrates/index.js';
import { ValidationError, type WriteContext } from '../core/types.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';

const NOW = '2026-07-16T12:00:00.000Z';

function entity(
  id: string,
  type: string,
  fields: Record<string, unknown> = {},
): AnyEntity {
  return {
    id,
    type,
    title: id,
    ...fields,
  } as AnyEntity;
}

function serviceHarness(initial: readonly AnyEntity[] = []) {
  const store = new Map(initial.map(item => [item.id, item]));
  const service: IBacklogService = {
    get: vi.fn(async id => store.get(id)),
    getMarkdown: vi.fn(async () => null),
    list: vi.fn(async () => [...store.values()]),
    add: vi.fn(async candidate => {
      store.set(candidate.id, candidate);
      return candidate;
    }),
    save: vi.fn(async candidate => {
      store.set(candidate.id, candidate);
      return candidate;
    }),
    delete: vi.fn(async id => store.delete(id)),
    counts: vi.fn(async () => ({
      total_tasks: 0,
      total_epics: 0,
      by_status: {},
      by_type: {},
    })),
    getMaxId: vi.fn(async () => 0),
    allocateId: vi.fn(async type => `${type}-generated`),
    searchUnified: vi.fn(async () => []),
  };
  return { service, store };
}

function contextHarness(): {
  context: WriteContext;
  entries: unknown[];
  emit: ReturnType<typeof vi.fn>;
} {
  const entries: unknown[] = [];
  const emit = vi.fn();
  return {
    entries,
    emit,
    context: {
      actor: { type: 'agent', name: 'chert' },
      operationLog: {
        append: entry => entries.push(entry),
        query: async () => [],
        countForTask: async () => 0,
      },
      eventBus: { emit },
    },
  };
}

function validatorHarness(): {
  validator: IntentWriteValidatorPort;
  validateWrite: ReturnType<typeof vi.fn>;
} {
  const validateWrite = vi.fn((candidate: unknown) => ({
    ok: true as const,
    entity: candidate as AnyEntity,
  }));
  return {
    validateWrite,
    validator: { validateWrite },
  };
}

function createIntent(): CompiledSubstrateIntent {
  return {
    sourcePath: 'builtin:requirement@1',
    substrateType: 'requirement',
    verb: 'capture_requirement',
    toolName: 'backlog_capture_requirement',
    description: 'Capture one requirement.',
    intentInputSchema: z.object({
      title: z.string(),
      content: z.string(),
      status: z.string().default('intake'),
    }).strict(),
    operation: {
      kind: 'create',
      fields: [
        { input: 'title', field: 'title' },
        { input: 'content', field: 'content' },
        { input: 'status', field: 'status' },
      ],
      fixedFields: { compliance: 'unchecked', status: 'fixed-status' },
    },
  };
}

function customCreateIntent(): CompiledSubstrateIntent {
  return {
    sourcePath: '.backlog/substrates/automation.yaml',
    substrateType: 'automation',
    verb: 'define',
    toolName: 'backlog_define_automation',
    description: 'Define one automation.',
    intentInputSchema: z.object({
      title: z.string(),
      command: z.number(),
      enabled: z.string(),
    }).strict(),
    operation: {
      kind: 'create',
      fields: [
        { input: 'title', field: 'title' },
        { input: 'command', field: 'command' },
        { input: 'enabled', field: 'enabled' },
      ],
      fixedFields: {},
    },
  };
}

function memoryCreateIntent(): CompiledSubstrateIntent {
  return {
    sourcePath: 'builtin:memory@compiled',
    substrateType: 'memory',
    verb: 'remember_internal',
    toolName: 'backlog_remember_internal',
    description: 'Persist one memory through the converged create funnel.',
    intentInputSchema: z.object({
      title: z.string(),
      content: z.string(),
    }).strict(),
    operation: {
      kind: 'create',
      fields: [
        { input: 'title', field: 'title' },
        { input: 'content', field: 'content' },
      ],
      fixedFields: {
        layer: 'semantic',
        source: 'human',
        usage_count: 0,
      },
    },
  };
}

function transitionIntent(): CompiledSubstrateIntent {
  return {
    sourcePath: 'builtin:task@compiled',
    substrateType: 'task',
    verb: 'complete',
    toolName: 'backlog_complete_task',
    description: 'Complete one task.',
    intentInputSchema: z.object({
      id: z.string(),
      evidence: z.array(z.string()).optional(),
    }).strict(),
    operation: {
      kind: 'transition',
      subjectInput: 'id',
      transition: {
        field: 'status',
        from: ['open', 'in_progress', 'blocked'],
        to: 'done',
      },
      fields: [{ input: 'evidence', field: 'evidence' }],
    },
  };
}

function setFieldIntent(): CompiledSubstrateIntent {
  return {
    sourcePath: 'builtin:cron@compiled',
    substrateType: 'cron',
    verb: 'pause',
    toolName: 'backlog_pause_cron',
    description: 'Pause one cron.',
    intentInputSchema: z.object({ id: z.string() }).strict(),
    operation: {
      kind: 'set-field',
      subjectInput: 'id',
      field: 'enabled',
      value: false,
    },
  };
}

function clearFieldIntent(): CompiledSubstrateIntent {
  return {
    sourcePath: '.backlog/substrates/decision.yaml',
    substrateType: 'decision',
    verb: 'clear_review',
    toolName: 'backlog_clear_review_decision',
    description: 'Clear a decision review marker.',
    intentInputSchema: z.object({ id: z.string() }).strict(),
    operation: {
      kind: 'set-field',
      subjectInput: 'id',
      field: 'reviewed_by',
      value: null,
    },
  };
}

function supersedeIntent(): CompiledSubstrateIntent {
  return {
    sourcePath: 'builtin:adr@1',
    substrateType: 'adr',
    verb: 'supersede',
    toolName: 'backlog_supersede_adr',
    description: 'Supersede one ADR with another.',
    intentInputSchema: z.object({
      replacement_id: z.string(),
      superseded_id: z.string(),
    }).strict(),
    operation: {
      kind: 'relate-and-transition',
      sourceInput: 'replacement_id',
      targetInput: 'superseded_id',
      relation: {
        field: 'supersedes',
        cardinality: 'many',
        targets: ['adr'],
      },
      targetTransition: {
        field: 'status',
        from: ['accepted', 'living'],
        to: 'superseded',
      },
    },
  };
}

describe('executeSubstrateIntent', () => {
  it('maps create inputs and applies compiler fixed fields last', async () => {
    const { service, store } = serviceHarness();
    const { context, entries } = contextHarness();
    const { validator } = validatorHarness();

    const result = await executeSubstrateIntent({
      intent: createIntent(),
      input: {
        title: 'Requirement',
        content: 'Must remain local-first.',
        status: 'override-attempt',
      },
      service,
      validator,
      context,
    });

    expect(result).toEqual({ ids: ['requirement-generated'], changed: true });
    expect(store.get('requirement-generated')).toMatchObject({
      type: 'requirement',
      title: 'Requirement',
      content: 'Must remain local-first.',
      status: 'fixed-status',
      compliance: 'unchecked',
    });
    expect(entries).toEqual([
      expect.objectContaining({
        tool: 'backlog_capture_requirement',
        mutation: 'create',
        resourceId: 'requirement-generated',
      }),
    ]);
  });

  it('preserves custom fields whose names overlap legacy built-in parameters', async () => {
    const { service, store } = serviceHarness();
    const { context } = contextHarness();
    const { validator } = validatorHarness();

    await executeSubstrateIntent({
      intent: customCreateIntent(),
      input: {
        title: 'Nightly automation',
        command: 42,
        enabled: 'manual',
      },
      service,
      validator,
      context,
    });

    expect(store.get('automation-generated')).toMatchObject({
      type: 'automation',
      command: 42,
      enabled: 'manual',
    });
  });

  it('never recursively captures a memory created through the converged funnel', async () => {
    const { service, store } = serviceHarness();
    const { context, entries } = contextHarness();
    const capture = vi.fn();
    context.memoryComposer = {
      store: capture,
    } as unknown as NonNullable<WriteContext['memoryComposer']>;
    const { validator } = validatorHarness();

    await executeSubstrateIntent({
      intent: memoryCreateIntent(),
      input: {
        title: 'No recursive capture',
        content: 'Memory writes do not create memories about themselves.',
      },
      service,
      validator,
      context,
    });

    expect([...store.values()]).toHaveLength(1);
    expect(store.get('memory-generated')).toMatchObject({
      type: 'memory',
      layer: 'semantic',
    });
    expect(capture).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
  });

  it('applies transition fields and semantic attribution', async () => {
    const task = entity('TASK-0001', 'task', {
      status: 'in_progress',
      created_at: NOW,
      updated_at: NOW,
    });
    const { service, store } = serviceHarness([task]);
    const { context, entries } = contextHarness();
    const { validator } = validatorHarness();

    await executeSubstrateIntent({
      intent: transitionIntent(),
      input: { id: task.id, evidence: ['PR #1'] },
      service,
      validator,
      context,
    });

    expect(store.get(task.id)).toMatchObject({
      status: 'done',
      evidence: ['PR #1'],
    });
    expect(entries).toEqual([
      expect.objectContaining({
        tool: 'backlog_complete_task',
        mutation: 'update',
        resourceId: task.id,
      }),
    ]);
  });

  it('treats an already-completed transition as an idempotent no-op', async () => {
    const task = entity('TASK-0001', 'task', {
      status: 'done',
      evidence: ['PR #1'],
      created_at: NOW,
      updated_at: NOW,
    });
    const { service } = serviceHarness([task]);
    const { context, entries } = contextHarness();
    const { validator } = validatorHarness();

    const result = await executeSubstrateIntent({
      intent: transitionIntent(),
      input: { id: task.id, evidence: ['PR #1'] },
      service,
      validator,
      context,
    });

    expect(result.changed).toBe(false);
    expect(service.save).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  });

  it('applies bounded set-field and skips same-value retries', async () => {
    const cron = entity('CRON-0001', 'cron', {
      status: 'open',
      enabled: true,
      schedule: '* * * * *',
      command: 'echo',
      created_at: NOW,
      updated_at: NOW,
    });
    const { service, store } = serviceHarness([cron]);
    const { context, entries } = contextHarness();
    const { validator } = validatorHarness();

    const first = await executeSubstrateIntent({
      intent: setFieldIntent(),
      input: { id: cron.id },
      service,
      validator,
      context,
    });
    const second = await executeSubstrateIntent({
      intent: setFieldIntent(),
      input: { id: cron.id },
      service,
      validator,
      context,
    });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(store.get(cron.id)?.enabled).toBe(false);
    expect(entries).toHaveLength(1);
  });

  it('persists a compiler-owned null as a literal value', async () => {
    const decision = entity('decision-001-root', 'decision', {
      reviewed_by: 'goga',
    });
    const { service, store } = serviceHarness([decision]);
    const { context, entries } = contextHarness();
    const { validator } = validatorHarness();

    await executeSubstrateIntent({
      intent: clearFieldIntent(),
      input: { id: decision.id },
      service,
      validator,
      context,
    });

    expect(store.get(decision.id)).toHaveProperty('reviewed_by', null);
    expect(entries).toEqual([
      expect.objectContaining({
        tool: 'backlog_clear_review_decision',
        params: {
          id: decision.id,
          reviewed_by: null,
        },
      }),
    ]);
  });

  it('validates both supersede postimages before writing and journals once', async () => {
    const replacement = entity('ADR 0002', 'adr', {
      status: 'proposed',
      supersedes: [],
      created_at: NOW,
      updated_at: NOW,
    });
    const superseded = entity('ADR 0001', 'adr', {
      status: 'accepted',
      created_at: NOW,
      updated_at: NOW,
    });
    const { service, store } = serviceHarness([replacement, superseded]);
    const { context, entries } = contextHarness();
    const { validator, validateWrite } = validatorHarness();

    const result = await executeSubstrateIntent({
      intent: supersedeIntent(),
      input: {
        replacement_id: replacement.id,
        superseded_id: superseded.id,
      },
      service,
      validator,
      context,
    });

    expect(result).toEqual({
      ids: [replacement.id, superseded.id],
      changed: true,
    });
    expect(validateWrite).toHaveBeenCalledTimes(2);
    expect(store.get(replacement.id)?.supersedes).toEqual([superseded.id]);
    expect(store.get(superseded.id)?.status).toBe('superseded');
    const replacementUpdatedAt = store.get(replacement.id)?.updated_at;
    const supersededUpdatedAt = store.get(superseded.id)?.updated_at;
    expect(replacementUpdatedAt).not.toBe(NOW);
    expect(replacementUpdatedAt).toBe(supersededUpdatedAt);
    expect(entries).toEqual([
      expect.objectContaining({
        tool: 'backlog_supersede_adr',
        mutation: 'update',
        resourceId: replacement.id,
      }),
    ]);
  });

  it('does not start a supersede plan when either postimage is invalid', async () => {
    const replacement = entity('ADR 0002', 'adr', {
      status: 'proposed',
      supersedes: [],
    });
    const superseded = entity('ADR 0001', 'adr', { status: 'accepted' });
    const { service, store } = serviceHarness([replacement, superseded]);
    const { context, entries } = contextHarness();
    const validateWrite = vi.fn()
      .mockReturnValueOnce({ ok: true, entity: replacement })
      .mockReturnValueOnce({
        ok: false,
        issues: [{
          code: 'shape',
          path: 'status',
          message: 'invalid transition target',
        }],
      });

    await expect(executeSubstrateIntent({
      intent: supersedeIntent(),
      input: {
        replacement_id: replacement.id,
        superseded_id: superseded.id,
      },
      service,
      validator: { validateWrite },
      context,
    })).rejects.toThrow(/postimage failed validation/);

    expect(validateWrite).toHaveBeenCalledTimes(2);
    expect(service.save).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  });

  it('restores a source whose first save persists and then rejects', async () => {
    const replacement = entity('ADR 0002', 'adr', {
      status: 'proposed',
      supersedes: [],
    });
    const superseded = entity('ADR 0001', 'adr', { status: 'accepted' });
    const { service, store } = serviceHarness([replacement, superseded]);
    const { context, entries } = contextHarness();
    const { validator } = validatorHarness();
    let saveCount = 0;
    vi.mocked(service.save).mockImplementation(async candidate => {
      saveCount += 1;
      store.set(candidate.id, candidate);
      if (saveCount === 1) throw new Error('source post-write failure');
      return candidate;
    });

    await expect(executeSubstrateIntent({
      intent: supersedeIntent(),
      input: {
        replacement_id: replacement.id,
        superseded_id: superseded.id,
      },
      service,
      validator,
      context,
    })).rejects.toMatchObject({
      code: 'compensated-failure',
      ids: [replacement.id, superseded.id],
      compensationSucceeded: true,
    });

    expect(service.save).toHaveBeenCalledTimes(2);
    expect(store.get(replacement.id)).toEqual(replacement);
    expect(entries).toEqual([]);
  });

  it('restores both entities when the second save persists and then rejects', async () => {
    const replacement = entity('ADR 0002', 'adr', {
      status: 'proposed',
      supersedes: [],
      created_at: NOW,
      updated_at: NOW,
    });
    const superseded = entity('ADR 0001', 'adr', {
      status: 'accepted',
      created_at: NOW,
      updated_at: NOW,
    });
    const { service, store } = serviceHarness([replacement, superseded]);
    const { context, entries } = contextHarness();
    const { validator } = validatorHarness();
    let saveCount = 0;
    vi.mocked(service.save).mockImplementation(async candidate => {
      saveCount += 1;
      store.set(candidate.id, candidate);
      if (saveCount === 2) throw new Error('target post-write failure');
      return candidate;
    });

    await expect(executeSubstrateIntent({
      intent: supersedeIntent(),
      input: {
        replacement_id: replacement.id,
        superseded_id: superseded.id,
      },
      service,
      validator,
      context,
    })).rejects.toMatchObject({
      code: 'compensated-failure',
      compensationSucceeded: true,
    });
    expect(store.get(replacement.id)).toEqual(replacement);
    expect(store.get(superseded.id)).toEqual(superseded);
    expect(service.save).toHaveBeenCalledTimes(4);
    expect(vi.mocked(service.save).mock.calls[0]?.[0].updated_at).not.toBe(NOW);
    expect(vi.mocked(service.save).mock.calls[1]?.[0].updated_at).not.toBe(NOW);
    expect(vi.mocked(service.save).mock.calls[2]?.[0]).toEqual(superseded);
    expect(vi.mocked(service.save).mock.calls[3]?.[0]).toEqual(replacement);
    expect(entries).toEqual([]);
  });

  it('reports partial_failure when supersede compensation also fails', async () => {
    const replacement = entity('ADR 0002', 'adr', {
      status: 'proposed',
      supersedes: [],
    });
    const superseded = entity('ADR 0001', 'adr', { status: 'accepted' });
    const { service } = serviceHarness([replacement, superseded]);
    const { context, entries } = contextHarness();
    const { validator } = validatorHarness();
    let saveCount = 0;
    vi.mocked(service.save).mockImplementation(async candidate => {
      saveCount += 1;
      if (saveCount >= 2) throw new Error(`save ${saveCount} failed`);
      return candidate;
    });

    let failure: unknown;
    try {
      await executeSubstrateIntent({
        intent: supersedeIntent(),
        input: {
          replacement_id: replacement.id,
          superseded_id: superseded.id,
        },
        service,
        validator,
        context,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SubstrateIntentExecutionError);
    expect(failure).toMatchObject({
      code: 'partial_failure',
      ids: [replacement.id, superseded.id],
      compensationSucceeded: false,
    });
    expect(entries).toEqual([]);
  });

  it('rejects wrong subject and relation target substrate types', async () => {
    const task = entity('TASK-0001', 'task', {
      status: 'open',
      created_at: NOW,
      updated_at: NOW,
    });
    const replacement = entity('ADR 0002', 'adr', {
      status: 'proposed',
      supersedes: [],
    });
    const { service } = serviceHarness([task, replacement]);
    const { context } = contextHarness();
    const { validator } = validatorHarness();

    await expect(executeSubstrateIntent({
      intent: transitionIntent(),
      input: { id: replacement.id },
      service,
      validator,
      context,
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(executeSubstrateIntent({
      intent: supersedeIntent(),
      input: {
        replacement_id: replacement.id,
        superseded_id: task.id,
      },
      service,
      validator,
      context,
    })).rejects.toThrow(/cannot target substrate task/);
  });
});
