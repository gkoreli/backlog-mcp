import type { Entity, Memory } from '@backlog-mcp/shared';
import type { RelevanceJudgment } from '../../../../memory/src/search/evaluation.js';

export const SEARCH_RELEVANCE_FIXTURE_VERSION = 1;
export const SEARCH_RELEVANCE_FIXTURE_NOW = '2026-07-16T12:00:00.000Z';

export type RelevanceQueryClass =
  | 'navigation'
  | 'exact-title'
  | 'lexical'
  | 'compound'
  | 'filtered'
  | 'aboutness'
  | 'tail'
  | 'memory-recall';

interface SearchQueryOptions {
  types?: Array<'task' | 'epic' | 'memory'>;
  status?: Array<'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled'>;
  parent_id?: string;
  limit?: number;
}

interface RecallQueryOptions {
  layers?: Array<'episodic' | 'semantic' | 'procedural'>;
  context?: string;
  tags?: string[];
  limit?: number;
}

interface JudgedQueryBase {
  id: string;
  class: RelevanceQueryClass;
  query: string;
  judgments: RelevanceJudgment[];
  assessor: string;
  rationale: string;
  provenance: string[];
  expectedFailure?: 'post-filter-overfetch';
}

export interface JudgedSearchQuery extends JudgedQueryBase {
  surface: 'search';
  options?: SearchQueryOptions;
}

export interface JudgedRecallQuery extends JudgedQueryBase {
  surface: 'recall';
  options?: RecallQueryOptions;
}

export type JudgedRelevanceQuery = JudgedSearchQuery | JudgedRecallQuery;
type DraftJudgedRelevanceQuery =
  | Omit<JudgedSearchQuery, 'assessor' | 'rationale' | 'provenance'>
  | Omit<JudgedRecallQuery, 'assessor' | 'rationale' | 'provenance'>;

export const SEARCH_RELEVANCE_FIXTURE_PROVENANCE = [
  'docs/adr/0038-comprehensive-search-capability.md',
  'docs/adr/0083-search-service-review-and-next-generation.md',
  'docs/adr/0092.3-memory-experience-and-substrate.md',
  'docs/adr/0092.9-phase-e-usage-feedback-research-and-plan.md',
  'docs/adr/0112-docs-native-project-scoped-backlog.md',
  'docs/adr/0116-search-and-rag-uplift.md',
  'packages/server/src/__tests__/search-golden.test.ts',
  'packages/server/src/__tests__/memory-store-contract.test.ts',
] as const;

const CREATED_AT = '2026-06-01T12:00:00.000Z';
const UPDATED_AT = '2026-07-15T12:00:00.000Z';

function task(
  id: string,
  title: string,
  content: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    type: 'task',
    title,
    content,
    status: 'open',
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  } as Entity;
}

function epic(id: string, title: string, content: string): Entity {
  return {
    id,
    type: 'epic',
    title,
    content,
    status: 'in_progress',
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
  };
}

function memory(
  id: string,
  title: string,
  content: string,
  overrides: Partial<Memory> = {},
): Entity {
  return {
    id,
    type: 'memory',
    title,
    content,
    layer: 'semantic',
    source: 'fixture',
    usage_count: 0,
    created_at: '2026-01-01T12:00:00.000Z',
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

const STRESS_EXPIRED_MEMORY_IDS = Array.from(
  { length: 61 },
  (_, index) => `MEMO-${String(index + 100).padStart(4, '0')}`,
);

const STRESS_EXPIRED_MEMORIES = STRESS_EXPIRED_MEMORY_IDS.map((id, index) => memory(
  id,
  `Recall saturation protocol archived ${String(index + 1).padStart(2, '0')}`,
  'Recall saturation protocol for filtered memory retrieval.',
  {
    layer: 'episodic',
    tags: ['recall-stress'],
    kind: 'historical',
    valid_until: '2026-06-01T12:00:00.000Z',
  },
));

/**
 * Stable, reviewable corpus used by the ADR 0116 relevance gate.
 *
 * Tail markers are intentionally distinctive and occur late in long bodies;
 * they protect whole-document lexical retrieval until a measured chunking
 * phase deliberately changes that behavior.
 */
export const SEARCH_RELEVANCE_ENTITIES: Entity[] = [
  epic(
    'EPIC-0001',
    'Search and RAG uplift',
    'Measure local-first retrieval quality before changing fusion, embeddings, chunking, or reranking.',
  ),
  epic(
    'EPIC-0002',
    'Docs-native backlog homes',
    'Treat Markdown folders as first-class homes with independent local indexes and watcher reconciliation.',
  ),
  epic(
    'EPIC-0003',
    'Memory experience',
    'Make durable memory recall trustworthy, scoped, inspectable, and usage-aware.',
  ),
  epic(
    'EPIC-0004',
    'Viewer experience',
    'Improve keyboard-first navigation, search diagnostics, and human-visible derived state.',
  ),

  task(
    'TASK-0001',
    'Implement exact-title navigation',
    'Pin exact multi-token title matches above ordinary full-text results without turning every common word into a pin.',
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0002',
    'Build judged relevance fixture',
    'Create a versioned query set with graded qrels for search and the real memory recall surface.',
    { parent_id: 'EPIC-0001', status: 'in_progress' },
  ),
  task(
    'TASK-0003',
    'Add nDCG metric harness',
    'Compute nDCG at ten, reciprocal rank, success at one, and recall at twenty deterministically.',
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0004',
    'Retry local embedding initialization',
    'Embedding startup failures must be visible and retryable instead of permanently disabling hybrid retrieval.',
    { parent_id: 'EPIC-0001', status: 'blocked', blocked_reason: ['Needs a per-home readiness state'] },
  ),
  task(
    'TASK-0005',
    'Write atomic search snapshots',
    'Persist the Orama cache through a temporary file and rename so interruption cannot leave truncated JSON.',
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0006',
    'Normalize resource frontmatter',
    'Index resource titles and metadata using the same normalized frontmatter that the read path exposes.',
    { parent_id: 'EPIC-0001', status: 'done' },
  ),
  task(
    'TASK-0007',
    'Prototype heading-aware Markdown chunks',
    'If tail-content evaluation fails, split long Markdown on headings and paragraphs while retaining the heading path.',
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0008',
    'Merge cross-home ranks with RRF',
    'Combine per-home result ranks without comparing incomparable raw scores, preserving home provenance and deterministic ties.',
    { parent_id: 'EPIC-0002' },
  ),
  task(
    'TASK-0009',
    'Fix FeatureStore tokenizer coverage',
    'Compound expansion makes FeatureStore and YavapaiMFE searchable as feature store and MFE.',
    { parent_id: 'EPIC-0001', status: 'done' },
  ),
  task(
    'TASK-0010',
    'Show per-home search readiness',
    'The viewer should display lexical ready, semantic warming, hybrid ready, and degraded states with failure reasons.',
    { parent_id: 'EPIC-0004' },
  ),
  task(
    'TASK-0011',
    'Keep agentic retrieval outside the server',
    'Agents may decompose a question and iteratively call deterministic reads, but no LLM belongs in the server write path.',
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0012',
    'Remove first-search bootstrap latency',
    'Build lexical search at startup so the first user query does not wait for embedding model initialization.',
    { parent_id: 'EPIC-0001', status: 'blocked', blocked_reason: ['Requires runtime startup seam'] },
  ),
  task(
    'TASK-0013',
    'Route query intent before retrieval',
    'Recognize exact entity identifiers and leading status or type filters before running full-text retrieval.',
    { parent_id: 'EPIC-0001', status: 'done' },
  ),
  task(
    'TASK-0014',
    'Benchmark a small local cross-encoder',
    'Measure a bounded second-pass relevance scorer over a small candidate pool before adopting reranking.',
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0015',
    'Detect embedding truncation',
    'Measure whether long Markdown loses important tail passages beyond the local embedding model token limit.',
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0016',
    'Keep search storage decoupled',
    'The storage adapter remains authoritative while the search index is disposable derived state.',
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0017',
    'Apply bounded recall usage multiplier',
    'Recall usage can reorder memories between zero point three and one point five times, but never hide them.',
    { parent_id: 'EPIC-0003', status: 'done' },
  ),
  task(
    'TASK-0018',
    'Protect the golden recall contract',
    'Keep exclusion, lineage, grace period, scoping, and usage behavior green while retrieval ranking evolves.',
    { parent_id: 'EPIC-0003' },
  ),
  task(
    'TASK-0019',
    'Compare local embedding models',
    'Benchmark MiniLM against one small local challenger for quality, startup time, memory, and index size.',
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0020',
    'Reconcile docs-native watcher changes',
    'External Markdown edits trigger one full entity and resource reconciliation for the owning backlog home.',
    { parent_id: 'EPIC-0002' },
  ),
  task(
    'TASK-0021',
    'Improve authentication recovery',
    'Refresh login credentials after an expired OAuth session so users can regain secure account access.',
    { parent_id: 'EPIC-0004' },
  ),
  task(
    'TASK-0022',
    'Repair deployment automation',
    'Fix the continuous delivery pipeline that publishes a release to staging and production.',
    { parent_id: 'EPIC-0004' },
  ),
  task(
    'TASK-0023',
    'Optimize slow database queries',
    'Add indexes and inspect query plans to reduce response latency for persistence reads.',
    { parent_id: 'EPIC-0004' },
  ),
  task(
    'TASK-0024',
    'Add keyboard-first command palette',
    'Open commands and search without leaving the keyboard; support shortcuts and fast navigation.',
    { parent_id: 'EPIC-0004' },
  ),
  task(
    'TASK-0025',
    'Document watcher reconciliation internals',
    `${'Explain deterministic event batching and authoritative rescans. '.repeat(18)}
The final operational recovery marker is quartz kestrel.`,
    { parent_id: 'EPIC-0002' },
  ),
  task(
    'TASK-0026',
    'Record snapshot recovery procedure',
    `${'Describe cache validation, rebuild behavior, and interruption handling. '.repeat(18)}
The final recovery drill marker is saffron lantern.`,
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0027',
    'Catalog embedding startup diagnostics',
    `${'List runtime versions, model fingerprints, cache state, and failure reasons. '.repeat(18)}
The final diagnostic marker is cobalt orchard.`,
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0028',
    'Explain relevance judgment workflow',
    `${'Document pooled judgments, graded relevance, holdout discipline, and review. '.repeat(18)}
The final assessor calibration marker is marble compass.`,
    { parent_id: 'EPIC-0001' },
  ),
  task(
    'TASK-0029',
    'Describe per-home result provenance',
    `${'Explain independent indexes, duplicate local identifiers, and deterministic merge order. '.repeat(18)}
The final provenance marker is violet harbor.`,
    { parent_id: 'EPIC-0002' },
  ),

  memory(
    'MEMO-0001',
    'Search fusion decision',
    'Use RRF only to merge independent backlog homes. Keep within-home rank-normalized weighted fusion until the judged fixture selects a winner.',
    { tags: ['search', 'decision'], kind: 'current' },
  ),
  memory(
    'MEMO-0002',
    'Embedding failure behavior',
    'A transformers initialization failure currently degrades search to BM25 for the process lifetime. The future state must be visible and retryable per home.',
    { tags: ['search', 'embedding'], kind: 'current' },
  ),
  memory(
    'MEMO-0003',
    'Recall usage law',
    'Usage reorders but never hides a memory. The multiplier stays between 0.3x and 1.5x after a fourteen-day grace period.',
    {
      tags: ['memory', 'ranking'],
      kind: 'timeless',
      usage_count: 8,
      last_used_at: '2026-07-15T12:00:00.000Z',
    },
  ),
  memory(
    'MEMO-0004',
    'Old cloud parity plan',
    'Maintain feature parity with D1 and Workers for every search capability.',
    {
      tags: ['deployment'],
      kind: 'historical',
      valid_until: '2026-06-01T12:00:00.000Z',
    },
  ),
  memory(
    'MEMO-0005',
    'Docs home watcher gotcha',
    'Watcher batches must reconcile entities and resources from fresh authoritative Markdown before publishing the new home index.',
    {
      parent_id: 'FLDR-0001',
      tags: ['docs-native', 'watcher'],
      kind: 'current',
    },
  ),
  memory(
    'MEMO-0006',
    'Release checklist',
    'Run typecheck and unit tests, update the version, create the matching tag, then publish the packed server artifact.',
    {
      layer: 'procedural',
      tags: ['release'],
      kind: 'timeless',
    },
  ),
  memory(
    'MEMO-0007',
    'Search fixture control',
    'The deterministic CI control has forty judged queries and records nDCG at ten, MRR, success at one, and recall at twenty.',
    {
      tags: ['search', 'evaluation'],
      kind: 'current',
      usage_count: 0,
    },
  ),
  memory(
    'MEMO-0008',
    'Superseded fusion decision',
    'Replace all search ranking with a single raw-score merge across every backlog home.',
    {
      tags: ['search', 'decision'],
      kind: 'historical',
      supersedes: 'MEMO-0001',
      valid_until: '2026-05-01T12:00:00.000Z',
    },
  ),
  memory(
    'MEMO-0009',
    'Unscoped watcher note',
    'A watcher reconnect can retry with exponential backoff, but this note belongs to a different project home.',
    {
      parent_id: 'FLDR-0002',
      tags: ['docs-native', 'watcher'],
      kind: 'current',
    },
  ),
  memory(
    'MEMO-0010',
    'Recall usage draft',
    'Recall usage may influence memory ranking after the grace period.',
    {
      tags: ['memory', 'ranking'],
      kind: 'current',
      usage_count: 0,
    },
  ),
  ...STRESS_EXPIRED_MEMORIES,
  memory(
    'MEMO-0161',
    'Live filtered recall answer',
    'Recall saturation protocol for filtered memory retrieval.',
    {
      layer: 'procedural',
      tags: ['recall-stress'],
      kind: 'current',
    },
  ),
];

function judgments(...values: Array<[string, 0 | 1 | 2 | 3]>): RelevanceJudgment[] {
  return values.map(([id, grade]) => ({ id, grade }));
}

function stressJudgments(): RelevanceJudgment[] {
  return [
    ...STRESS_EXPIRED_MEMORY_IDS.map(id => ({ id, grade: 0 as const })),
    { id: 'MEMO-0161', grade: 3 },
  ];
}

/**
 * Forty frozen information needs: five per exercised class.
 *
 * Grades: 3 = ideal/direct answer, 2 = relevant, 1 = marginal context,
 * 0 = explicitly non-relevant. Unjudged documents remain distinct from an
 * explicit grade 0 in the source fixture, while metrics conservatively assign
 * no gain to either until a human judgment expands the pool.
 */
const RAW_SEARCH_RELEVANCE_QUERIES: DraftJudgedRelevanceQuery[] = [
  { id: 'nav-01', class: 'navigation', surface: 'search', query: 'TASK-0002', judgments: judgments(['TASK-0002', 3]) },
  { id: 'nav-02', class: 'navigation', surface: 'search', query: 'task 3', judgments: judgments(['TASK-0003', 3]) },
  { id: 'nav-03', class: 'navigation', surface: 'search', query: 'EPIC-0001', judgments: judgments(['EPIC-0001', 3]) },
  { id: 'nav-04', class: 'navigation', surface: 'search', query: 'epic 2', judgments: judgments(['EPIC-0002', 3]) },
  { id: 'nav-05', class: 'navigation', surface: 'search', query: 'Search and RAG uplift', judgments: judgments(['EPIC-0001', 3], ['TASK-0002', 1]) },

  { id: 'title-01', class: 'exact-title', surface: 'search', query: 'Build judged relevance fixture', judgments: judgments(['TASK-0002', 3], ['TASK-0028', 1]) },
  { id: 'title-02', class: 'exact-title', surface: 'search', query: 'Write atomic search snapshots', judgments: judgments(['TASK-0005', 3], ['TASK-0026', 2]) },
  { id: 'title-03', class: 'exact-title', surface: 'search', query: 'Show per-home search readiness', judgments: judgments(['TASK-0010', 3], ['TASK-0004', 1]) },
  { id: 'title-04', class: 'exact-title', surface: 'search', query: 'Apply bounded recall usage multiplier', judgments: judgments(['TASK-0017', 3], ['TASK-0018', 1]) },
  { id: 'title-05', class: 'exact-title', surface: 'search', query: 'Keep search storage decoupled', judgments: judgments(['TASK-0016', 3], ['TASK-0005', 1]) },

  { id: 'lex-01', class: 'lexical', surface: 'search', query: 'local embedding retry', judgments: judgments(['TASK-0004', 3], ['TASK-0019', 2], ['TASK-0012', 1]) },
  { id: 'lex-02', class: 'lexical', surface: 'search', query: 'resource frontmatter normalization', judgments: judgments(['TASK-0006', 3], ['TASK-0020', 1]) },
  { id: 'lex-03', class: 'lexical', surface: 'search', query: 'first search bootstrap latency', judgments: judgments(['TASK-0012', 3], ['TASK-0004', 1]) },
  { id: 'lex-04', class: 'lexical', surface: 'search', query: 'temporary file rename snapshot', judgments: judgments(['TASK-0005', 3], ['TASK-0026', 2]) },
  { id: 'lex-05', class: 'lexical', surface: 'search', query: 'viewer readiness failure reason', judgments: judgments(['TASK-0010', 3], ['EPIC-0004', 1]) },

  { id: 'compound-01', class: 'compound', surface: 'search', query: 'feature store', judgments: judgments(['TASK-0009', 3]) },
  { id: 'compound-02', class: 'compound', surface: 'search', query: 'keyboard first', judgments: judgments(['TASK-0024', 3], ['EPIC-0004', 1]) },
  { id: 'compound-03', class: 'compound', surface: 'search', query: 'cross home ranks', judgments: judgments(['TASK-0008', 3], ['TASK-0029', 2]) },
  { id: 'compound-04', class: 'compound', surface: 'search', query: 'docs native watcher', judgments: judgments(['TASK-0020', 3], ['EPIC-0002', 2], ['TASK-0025', 1]) },
  { id: 'compound-05', class: 'compound', surface: 'search', query: 'rank fusion', judgments: judgments(['TASK-0008', 3], ['EPIC-0001', 1]) },

  { id: 'filter-01', class: 'filtered', surface: 'search', query: 'embedding', options: { status: ['blocked'] }, judgments: judgments(['TASK-0004', 3], ['TASK-0012', 2]) },
  { id: 'filter-02', class: 'filtered', surface: 'search', query: 'search', options: { types: ['epic'] }, judgments: judgments(['EPIC-0001', 3], ['EPIC-0003', 1]) },
  { id: 'filter-03', class: 'filtered', surface: 'search', query: 'ranking', options: { parent_id: 'EPIC-0003' }, judgments: judgments(['TASK-0017', 3], ['TASK-0018', 2]) },
  { id: 'filter-04', class: 'filtered', surface: 'search', query: 'query intent', options: { status: ['done'] }, judgments: judgments(['TASK-0013', 3], ['TASK-0009', 1]) },
  { id: 'filter-05', class: 'filtered', surface: 'search', query: 'watcher', options: { parent_id: 'EPIC-0002' }, judgments: judgments(['TASK-0020', 3], ['TASK-0025', 2], ['TASK-0029', 1]) },

  { id: 'about-01', class: 'aboutness', surface: 'search', query: 'login credentials recovery', judgments: judgments(['TASK-0021', 3]) },
  { id: 'about-02', class: 'aboutness', surface: 'search', query: 'shipping automation failure', judgments: judgments(['TASK-0022', 3]) },
  { id: 'about-03', class: 'aboutness', surface: 'search', query: 'persistence reads are sluggish', judgments: judgments(['TASK-0023', 3]) },
  { id: 'about-04', class: 'aboutness', surface: 'search', query: 'second pass relevance scorer', judgments: judgments(['TASK-0014', 3], ['TASK-0002', 1]) },
  { id: 'about-05', class: 'aboutness', surface: 'search', query: 'split long markdown sections', judgments: judgments(['TASK-0007', 3], ['TASK-0015', 2]) },

  { id: 'tail-01', class: 'tail', surface: 'search', query: 'quartz kestrel', judgments: judgments(['TASK-0025', 3]) },
  { id: 'tail-02', class: 'tail', surface: 'search', query: 'saffron lantern', judgments: judgments(['TASK-0026', 3]) },
  { id: 'tail-03', class: 'tail', surface: 'search', query: 'cobalt orchard', judgments: judgments(['TASK-0027', 3]) },
  { id: 'tail-04', class: 'tail', surface: 'search', query: 'marble compass', judgments: judgments(['TASK-0028', 3]) },
  { id: 'tail-05', class: 'tail', surface: 'search', query: 'violet harbor', judgments: judgments(['TASK-0029', 3]) },

  { id: 'recall-01', class: 'memory-recall', surface: 'recall', query: 'which fusion policy should search use', options: { tags: ['decision'], limit: 20 }, judgments: judgments(['MEMO-0001', 3], ['MEMO-0008', 0]) },
  { id: 'recall-02', class: 'memory-recall', surface: 'recall', query: 'recall saturation protocol', options: { layers: ['procedural'], tags: ['recall-stress'], limit: 20 }, judgments: stressJudgments(), expectedFailure: 'post-filter-overfetch' },
  { id: 'recall-03', class: 'memory-recall', surface: 'recall', query: 'how do we publish a release', options: { layers: ['procedural'], tags: ['release'], limit: 20 }, judgments: judgments(['MEMO-0006', 3]) },
  { id: 'recall-04', class: 'memory-recall', surface: 'recall', query: 'docs home watcher reconciliation', options: { context: 'FLDR-0001', tags: ['watcher'], limit: 20 }, judgments: judgments(['MEMO-0005', 3], ['MEMO-0009', 0]) },
  { id: 'recall-05', class: 'memory-recall', surface: 'recall', query: 'how does recall usage ranking work', options: { tags: ['ranking'], limit: 20 }, judgments: judgments(['MEMO-0003', 3], ['MEMO-0010', 2]) },
];

const CLASS_RATIONALE: Record<RelevanceQueryClass, string> = {
  navigation: 'The grade-3 entity is the uniquely named ID or exact-title destination; lower grades are supporting context only.',
  'exact-title': 'The grade-3 entity owns the queried title; lower grades discuss the same subsystem without being the named destination.',
  lexical: 'Grades reflect direct term coverage of the stated engineering need, with grade 3 assigned to the primary implementation record.',
  compound: 'Grades reflect the expected entity after camel-case or hyphen-aware token expansion, plus directly supporting records.',
  filtered: 'Grades are assigned within the explicit type, status, or parent scope; out-of-scope matches are non-relevant.',
  aboutness: 'The grade-3 entity directly answers the paraphrased need even when the query and document use different surface terms.',
  tail: 'The unique marker appears only in the relevant long document tail and therefore identifies the expected parent record.',
  'memory-recall': 'Grades reflect the live, in-scope memory answer after expiry, lineage, layer, tag, context, and usage rules.',
};

const CLASS_PROVENANCE: Record<RelevanceQueryClass, string[]> = {
  navigation: [
    'docs/adr/0083-search-service-review-and-next-generation.md',
    'packages/server/src/__tests__/query-intent.test.ts',
    'packages/server/src/__tests__/search-golden.test.ts',
  ],
  'exact-title': [
    'docs/adr/0083-search-service-review-and-next-generation.md',
    'packages/server/src/__tests__/search-golden.test.ts',
  ],
  lexical: [
    'docs/adr/0038-comprehensive-search-capability.md',
    'packages/server/src/__tests__/search-golden.test.ts',
  ],
  compound: [
    'docs/adr/0041-hyphen-aware-tokenizer.md',
    'docs/adr/0083-search-service-review-and-next-generation.md',
    'packages/server/src/__tests__/search-golden.test.ts',
  ],
  filtered: [
    'docs/adr/0079-orama-native-filtering.md',
    'packages/server/src/__tests__/query-intent.test.ts',
  ],
  aboutness: [
    'docs/adr/0038-comprehensive-search-capability.md',
    'docs/adr/0116-search-and-rag-uplift.md',
  ],
  tail: [
    'docs/adr/0116-search-and-rag-uplift.md',
  ],
  'memory-recall': [
    'docs/adr/0092.3-memory-experience-and-substrate.md',
    'docs/adr/0092.9-phase-e-usage-feedback-research-and-plan.md',
    'packages/server/src/__tests__/memory-store-contract.test.ts',
  ],
};

/**
 * Initial judgments are deliberately attributable. Beryl's domain review is
 * required before changing the assessor string or treating these qrels as a
 * production MiniLM benchmark rather than the deterministic CI control.
 */
export const SEARCH_RELEVANCE_QUERIES: JudgedRelevanceQuery[] =
  RAW_SEARCH_RELEVANCE_QUERIES.map(query => ({
    ...query,
    assessor: 'chert-initial-pending-beryl-review',
    rationale: `${CLASS_RATIONALE[query.class]} Expected judgments: ${query.judgments.map(judgment => `${judgment.id}=grade${judgment.grade}`).join(', ')}.`,
    provenance: CLASS_PROVENANCE[query.class],
  }));
