import {
  EntityType,
  type RuntimeSubstrateIntentDefinition,
  type SubstrateWorkflowDefinition,
} from '@backlog-mcp/shared';

interface BuiltinSubstrateIntentDefinition {
  readonly workflow?: SubstrateWorkflowDefinition;
  readonly intents: readonly RuntimeSubstrateIntentDefinition[];
}

const TASK_WORKFLOW: SubstrateWorkflowDefinition = {
  field: 'status',
  initial: ['open'],
  terminal: ['done', 'cancelled'],
  transitions: [
    {
      name: 'start',
      from: ['open', 'blocked'],
      to: 'in_progress',
    },
    {
      name: 'complete',
      from: ['open', 'in_progress', 'blocked'],
      to: 'done',
    },
    {
      name: 'block',
      from: ['open', 'in_progress'],
      to: 'blocked',
    },
  ],
};

/** Server-owned semantic intent declarations for the built-in substrates. */
export const BUILTIN_SUBSTRATE_INTENT_DEFINITIONS: Readonly<
  Partial<Record<EntityType, BuiltinSubstrateIntentDefinition>>
> = {
  [EntityType.Task]: {
    workflow: TASK_WORKFLOW,
    intents: [
      {
        verb: 'create_work',
        toolName: 'backlog_create_work',
        operation: 'create',
        description: 'Use when creating a project work item. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
        requiredInputs: ['title'],
        optionalInputs: ['content', 'parent_id', 'references'],
        defaults: { status: 'open' },
      },
      {
        verb: 'start',
        operation: 'transition',
        description: 'Use when starting active work on a task.',
        requiredInputs: ['id'],
        transition: 'start',
      },
      {
        verb: 'complete',
        operation: 'transition',
        description: 'Use when completing a task, optionally with evidence.',
        requiredInputs: ['id'],
        optionalInputs: ['evidence'],
        transition: 'complete',
      },
      {
        verb: 'block',
        operation: 'transition',
        description: 'Use when blocking a task with a reason.',
        requiredInputs: ['id', 'blocked_reason'],
        transition: 'block',
      },
    ],
  },
  [EntityType.Epic]: {
    intents: [{
      verb: 'plan',
      operation: 'create',
      description: 'Use when planning an epic that groups related work. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
      requiredInputs: ['title'],
      optionalInputs: ['content', 'parent_id', 'references'],
      defaults: { status: 'open' },
    }],
  },
  [EntityType.Folder]: {
    intents: [{
      verb: 'organize',
      operation: 'create',
      description: 'Use when creating a folder to organize project items. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
      requiredInputs: ['title'],
      optionalInputs: ['content', 'parent_id'],
    }],
  },
  [EntityType.Artifact]: {
    intents: [{
      verb: 'attach',
      operation: 'create',
      description: 'Use when attaching an artifact to a project item. parent_id is required.',
      requiredInputs: ['title', 'parent_id'],
      optionalInputs: [
        'content',
        'path',
        'content_type',
        'references',
      ],
    }],
  },
  [EntityType.Milestone]: {
    intents: [{
      verb: 'target',
      operation: 'create',
      description: 'Use when creating a milestone for a project target. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
      requiredInputs: ['title'],
      optionalInputs: [
        'content',
        'parent_id',
        'due_date',
        'references',
      ],
      defaults: { status: 'open' },
    }],
  },
  [EntityType.Cron]: {
    intents: [
      {
        verb: 'schedule',
        operation: 'create',
        description: 'Use when scheduling recurring project intake. Pass parent_id when known; parentless work surfaces as unfiled at wakeup.',
        requiredInputs: ['title', 'schedule', 'command'],
        optionalInputs: ['content', 'parent_id', 'enabled'],
        defaults: {
          status: 'open',
          enabled: true,
        },
      },
      {
        verb: 'pause',
        operation: 'set-field',
        description: 'Use when pausing a scheduled intake.',
        requiredInputs: ['id'],
        field: 'enabled',
        value: false,
      },
      {
        verb: 'resume',
        operation: 'set-field',
        description: 'Use when resuming a scheduled intake.',
        requiredInputs: ['id'],
        field: 'enabled',
        value: true,
      },
    ],
  },
};
