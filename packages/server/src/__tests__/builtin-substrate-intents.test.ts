import type {
  CompiledSubstrateIntent,
} from '@backlog-mcp/shared';
import { describe, expect, it } from 'vitest';
import {
  createBuiltinSubstrateRegistrations,
} from '../core/substrates/create-builtin-substrate-registrations.js';
import {
  BuiltinSubstrateStorageCatalog,
} from '../storage/local/builtin-substrate-storage-catalog.js';

const INTENTS = createBuiltinSubstrateRegistrations(
  new BuiltinSubstrateStorageCatalog(),
).flatMap(function substrateIntents(substrate) {
  return [...substrate.intents];
}).sort(function compareIntents(left, right) {
  return left.toolName.localeCompare(right.toolName);
});

function intent(toolName: string): CompiledSubstrateIntent {
  const compiled = INTENTS.find(function matchesName(candidate) {
    return candidate.toolName === toolName;
  });
  if (!compiled) throw new Error(`Missing built-in intent: ${toolName}`);
  return compiled;
}

describe('built-in substrate intent declarations', function describeBuiltins() {
  it('compiles exactly the eleven server-owned semantic intents', () => {
    expect(INTENTS.map(function toolName(compiled) {
      return compiled.toolName;
    })).toEqual([
      'backlog_attach_artifact',
      'backlog_block_task',
      'backlog_complete_task',
      'backlog_create_work',
      'backlog_organize_folder',
      'backlog_pause_cron',
      'backlog_plan_epic',
      'backlog_resume_cron',
      'backlog_schedule_cron',
      'backlog_start_task',
      'backlog_target_milestone',
    ]);
  });

  it('resolves creation fields and compiler-owned defaults', () => {
    expect(intent('backlog_create_work').operation).toEqual({
      kind: 'create',
      fields: [
        { input: 'title', field: 'title' },
        { input: 'content', field: 'content' },
        { input: 'parent_id', field: 'parent_id' },
        { input: 'references', field: 'references' },
      ],
      fixedFields: { status: 'open' },
    });
    expect(intent('backlog_plan_epic').operation).toMatchObject({
      kind: 'create',
      fixedFields: { status: 'open' },
    });
    expect(intent('backlog_organize_folder').operation).toMatchObject({
      kind: 'create',
      fixedFields: {},
    });
    expect(intent('backlog_attach_artifact').operation).toMatchObject({
      kind: 'create',
      fixedFields: {},
    });
    expect(intent('backlog_target_milestone').operation).toMatchObject({
      kind: 'create',
      fixedFields: { status: 'open' },
    });
    expect(intent('backlog_schedule_cron').operation).toEqual({
      kind: 'create',
      fields: [
        { input: 'title', field: 'title' },
        { input: 'schedule', field: 'schedule' },
        { input: 'command', field: 'command' },
        { input: 'content', field: 'content' },
        { input: 'parent_id', field: 'parent_id' },
        { input: 'enabled', field: 'enabled' },
      ],
      fixedFields: { status: 'open' },
    });
  });

  it('resolves Task lifecycle transitions and optional evidence', () => {
    expect(intent('backlog_start_task').operation).toEqual({
      kind: 'transition',
      subjectInput: 'id',
      transition: {
        field: 'status',
        from: ['open', 'blocked'],
        to: 'in_progress',
      },
      fields: [],
    });
    expect(intent('backlog_complete_task').operation).toEqual({
      kind: 'transition',
      subjectInput: 'id',
      transition: {
        field: 'status',
        from: ['open', 'in_progress', 'blocked'],
        to: 'done',
      },
      fields: [{ input: 'evidence', field: 'evidence' }],
    });
    expect(intent('backlog_block_task').operation).toEqual({
      kind: 'transition',
      subjectInput: 'id',
      transition: {
        field: 'status',
        from: ['open', 'in_progress'],
        to: 'blocked',
      },
      fields: [{ input: 'blocked_reason', field: 'blocked_reason' }],
    });
  });

  it('resolves Cron pause and resume as fixed enabled assignments', () => {
    expect(intent('backlog_pause_cron').operation).toEqual({
      kind: 'set-field',
      subjectInput: 'id',
      field: 'enabled',
      value: false,
    });
    expect(intent('backlog_resume_cron').operation).toEqual({
      kind: 'set-field',
      subjectInput: 'id',
      field: 'enabled',
      value: true,
    });
  });

  it('projects strict inputs with required fields and input defaults', () => {
    const createWork = intent('backlog_create_work').intentInputSchema;
    expect(createWork.parse({ title: 'Write the ADR' })).toEqual({
      title: 'Write the ADR',
    });
    expect(createWork.safeParse({
      title: 'Write the ADR',
      id: 'TASK-9999',
    }).success).toBe(false);

    const block = intent('backlog_block_task').intentInputSchema;
    expect(block.safeParse({ id: 'TASK-0001' }).success).toBe(false);
    expect(block.safeParse({
      id: 'TASK-0001',
      blocked_reason: ['Waiting on review'],
    }).success).toBe(true);

    const attach = intent('backlog_attach_artifact').intentInputSchema;
    expect(attach.safeParse({ title: 'Trace' }).success).toBe(false);
    expect(attach.safeParse({
      title: 'Trace',
      parent_id: 'TASK-0001',
    }).success).toBe(true);

    expect(intent('backlog_schedule_cron').intentInputSchema.parse({
      title: 'Nightly intake',
      schedule: '0 0 * * *',
      command: 'backlog sync',
    })).toEqual({
      title: 'Nightly intake',
      schedule: '0 0 * * *',
      command: 'backlog sync',
      enabled: true,
    });
  });
});
