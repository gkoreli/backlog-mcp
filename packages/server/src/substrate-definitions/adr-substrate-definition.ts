/** Native ADR actions, relations and disclosure over the shared schema (ADR 0113.2). */
import { type RuntimeSubstrateDefinition } from '@backlog-mcp/shared';

export const ADR_SUBSTRATE_POLICY = {
  workflow: {
    field: 'status',
    initial: ['draft', 'proposed', 'living'],
    terminal: ['rejected', 'superseded'],
    transitions: [
      {
        name: 'accept',
        from: ['draft', 'proposed', 'living'],
        to: 'accepted',
      },
      {
        name: 'supersede',
        from: ['accepted', 'living'],
        to: 'superseded',
        requiresRelation: 'superseded_by',
      },
    ],
  },
  relations: {
    supersedes: {
      targets: ['adr'],
      cardinality: 'many',
      inverse: 'superseded_by',
    },
    extends: {
      targets: ['adr'],
      cardinality: 'many',
    },
    implements: {
      targets: ['adr', 'requirement', 'task'],
      cardinality: 'many',
      inverse: 'implemented_by',
    },
    backlog_item: {
      targets: ['task', 'epic', 'artifact'],
      cardinality: 'many',
    },
    spawned_by: {
      targets: ['prompt', 'requirement'],
      cardinality: 'many',
      inverse: 'spawned',
    },
    respects: {
      targets: ['requirement'],
      cardinality: 'many',
      inverse: 'respected_by',
    },
    violates: {
      targets: ['requirement'],
      cardinality: 'many',
      inverse: 'violated_by',
    },
  },
  intents: [
    {
      verb: 'propose',
      operation: 'create',
      allocation: { strategy: 'thread-child', threadInput: 'thread' },
      description: 'Use when recording a proposed architectural decision in the current project.',
      requiredInputs: ['title', 'description', 'content'],
      optionalInputs: [
        'thread',
        'extends',
        'implements',
        'backlog_item',
        'spawned_by',
        'respects',
        'violates',
      ],
      defaults: {
        status: 'proposed',
      },
    },
    {
      verb: 'accept',
      operation: 'transition',
      description: 'Use when ratifying an existing proposed ADR.',
      requiredInputs: ['id'],
      transition: 'accept',
    },
    {
      verb: 'supersede',
      operation: 'relate-and-transition',
      description: 'Use when a newer ADR replaces an accepted or living ADR while preserving lineage.',
      requiredInputs: ['replacement_id', 'superseded_id'],
      relation: 'supersedes',
      sourceInput: 'replacement_id',
      targetInput: 'superseded_id',
      targetTransition: 'supersede',
    },
  ],
  disclosure: {
    discovery: { projection: ['description', 'date', 'extends', 'supersedes'] },
    search: {
      enabled: true,
      fields: ['title', 'description', 'content', 'status', 'date'],
    },
    get: {
      context: true,
      groupByRole: true,
      relations: [
        'supersedes',
        'extends',
        'implements',
        'backlog_item',
        'spawned_by',
        'respects',
        'violates',
      ],
    },
    wakeup: {
      section: 'decisions',
      // 'accepted' included (0113 C.2): the Cold-Open Test's decisions
      // orientation is ABOUT the accepted record — a cold agent needs
      // the decisions that shaped the codebase, not only open proposals.
      includeStatuses: ['proposed', 'accepted', 'living'],
      // 3, not 5 (Slice C budget discipline): the recency-ordered top
      // three carry the current record; sections_omitted states the
      // exact remainder and get() hydrates the rest on demand.
      limit: 3,
      projection: ['id', 'title', 'description', 'status'],
    },
  },
    } satisfies Pick<RuntimeSubstrateDefinition, 'workflow' | 'relations' | 'intents' | 'disclosure'>;
