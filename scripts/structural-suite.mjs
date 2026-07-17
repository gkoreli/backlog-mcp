#!/usr/bin/env node

/**
 * Structural truth suite (ADR 0121 R2).
 *
 * Walks the real project corpus at run time and emits constructively-true
 * assertions — no judge exists to be circular, and regeneration on every run
 * makes drift impossible. Assertion classes:
 *
 *   navigation-title      every document's title as a query; the document is
 *                         the sole grade-3 target by construction
 *   navigation-id         every entity's ID in BOTH space form ("ADR 0116")
 *                         and hyphen form ("ADR-0116") — report 0004 (nav-01)
 *                         proved the two families behave differently
 *   membership-title      every claimed document retrievable at all (top-20
 *                         for its own exact title)
 *   wakeup-reconciliation wakeup's disclosed per-section count equals the
 *                         corpus's independently counted eligible documents
 *                         (the check that would have caught the
 *                         status-matching bug)
 *   quarantine-visibility every claim quarantine is named in the briefing
 *   filter-compliance     a typed query returns only that type — a violation
 *                         is wrong by construction
 *   supersedes-ordering   where frontmatter declares supersession, the
 *                         superseding document ranks at or above the
 *                         superseded for their shared-stem query
 *   tail-reachability     content at declared token offsets (257–512, >512)
 *                         is reachable by querying its rarest tokens,
 *                         extracted mechanically — never by judgment
 *
 * The report is deterministic by design: no timestamps, no timings, stable
 * ordering everywhere. Two runs over the same corpus must be byte-identical.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const HELP = `Usage:
  pnpm suite:structural -- \\
    --project-root <project> \\
    --output <report.json> \\
    --summary <summary.md> \\
    [--modes bm25,hybrid]

Required:
  --project-root Docs-native project whose production search corpus is probed
  --output       Durable JSON report destination (excluded from the corpus)
  --summary      Human summary Markdown destination (excluded from the corpus)

Optional:
  --modes        Comma-separated search modes (default: bm25,hybrid)
  --help         Show this help

Run "pnpm build" before executing the suite.
`;

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const TRAINED_WINDOW_TOKENS = 256;
const RUNTIME_WINDOW_TOKENS = 512;
const NAVIGATION_WINDOW = 10;
const MEMBERSHIP_WINDOW = 20;
const ORDERING_WINDOW = 100;
const TAIL_WINDOW = 10;
const TAIL_QUERY_TOKENS = 4;
const TAIL_MINIMUM_ZONE_WORDS = 30;
const FILTER_QUERIES_PER_TYPE = 3;

const DECLARED_LIMITS = [
  'Structural navigation partly measures the product\'s own exact-ID and title-boost special cases. This suite is a tripwire for retrievability regressions; a green navigation class is NOT improvement evidence for ranking (ADR 0121 R2).',
  'Aboutness is out of scope by design. No assertion here grades topical relevance; that remains irreducibly a judgment under docs/evaluation/JUDGING.md.',
  'Query text is drawn from each target\'s own words (titles, IDs, tail tokens), so the suite tests reachability under the tokenizer contract, not vocabulary-mismatch retrieval (report 0004, lens B kill-evidence).',
  'Tail probes measure lexical (BM25-side) reachability of content beyond the embedding windows. A pass does not show the vector lane sees that content — by construction it cannot (tokens past 512 are absent from the vector).',
  'Temporal decay is disabled (no halfLifeDays), matching scripts/search-eval.mjs, so runs are deterministic. The production runtime applies a 30-day half-life at query time.',
  'The suite\'s own output files are excluded from the measured corpus (the search-eval excluded_output_path rule) so a checked-in report cannot feed itself back as corpus input. The production index does include checked-in reports.',
  'Wakeup reconciliation compares disclosed counts (stubs + omitted) against an independent eligible count. The briefing exposes only top-N stubs, so a count match with exactly compensating membership errors is not detectable from the public surface.',
  'The Requirement "constraints" wakeup section rides a specialized fold (live-constraint band ordering, not includeStatuses) and is not reconciled here; only generic declared wakeup sections are.',
  'Memory entities are excluded from generic search by product design (ADR 0092.3). A corpus containing memories needs recall-path probes this suite does not emit; their presence is reported and those documents are skipped.',
];

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function canonicalPath(filePath) {
  const absolutePath = resolve(filePath);
  if (existsSync(absolutePath)) return realpathSync(absolutePath);
  const parentPath = dirname(absolutePath);
  if (parentPath === absolutePath) return absolutePath;
  return join(canonicalPath(parentPath), basename(absolutePath));
}

function stableJsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function gitCommit(repoRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseArguments(argv) {
  if (argv.includes('--help')) return { help: true };
  const VALUE_ARGUMENTS = new Set(['project-root', 'output', 'summary', 'modes']);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (!token?.startsWith('--')) fail(`Unexpected positional argument: ${token ?? ''}`);
    const name = token.slice(2);
    if (!VALUE_ARGUMENTS.has(name)) fail(`Unknown option: --${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for --${name}`);
    if (values[name] !== undefined) fail(`Duplicate option: --${name}`);
    values[name] = value;
    index += 1;
  }
  for (const name of ['project-root', 'output', 'summary']) {
    if (values[name] === undefined) fail(`Missing required option: --${name}`);
  }
  const modes = (values.modes ?? 'bm25,hybrid').split(',').map(mode => mode.trim());
  for (const mode of modes) {
    if (mode !== 'bm25' && mode !== 'hybrid') fail(`Unsupported mode: ${mode}`);
  }
  if (modes.length === 0) fail('At least one mode is required');
  return {
    help: false,
    projectRoot: resolve(values['project-root']),
    output: resolve(values.output),
    summary: resolve(values.summary),
    modes,
  };
}

/**
 * Independent leading-token status normalization. Deliberately reimplemented
 * here (not imported from the product) so a regression in the product's
 * status-matching seam — the exact bug class that once made wakeup disclose
 * 1 of ~46 eligible ADRs — shows up as a reconciliation failure instead of
 * being reproduced on both sides of the comparison.
 */
function leadingStatusToken(value) {
  if (typeof value !== 'string') return undefined;
  const token = value.split(/[,(;]/u, 1)[0]?.trim().toLowerCase();
  return token ? token : undefined;
}

/** Mirror of the product's searchable-field text projection (textValue). */
function textValue(value) {
  if (value === null || value === undefined) return '';
  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(' ');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function entitySearchText(document) {
  return document.fields
    .map(field => textValue(field.value))
    .join(' ')
    .trim();
}

function resourceSearchText(resource) {
  return `${resource.title} ${resource.content}`.trim();
}

/** ID probe forms: the stored form plus its space/hyphen counterpart. */
function idQueryForms(id) {
  const match = /^([A-Za-z]+)[-\s](.+)$/u.exec(id);
  if (match === null) return [{ form: 'stored', query: id }];
  const [, prefix, key] = match;
  const forms = [
    { form: 'space', query: `${prefix} ${key}` },
    { form: 'hyphen', query: `${prefix}-${key}` },
  ];
  return forms;
}

/** Ordered word sequence using the product tokenizer's split contract. */
function wordSequence(text) {
  return text.split(/[^a-zA-Z0-9'-]+/u).filter(Boolean);
}

const WORD_CHAR = /[a-zA-Z0-9'-]/u;

/**
 * Slice a zone without minting fake tokens: a token-count boundary can land
 * mid-word, and a sliced fragment ("ogether", "wakeu") is not corpus
 * vocabulary. Partial words at either edge are dropped mechanically.
 */
function snapSlice(text, start, end) {
  let from = start;
  if (from > 0 && WORD_CHAR.test(text[from - 1] ?? '') && WORD_CHAR.test(text[from] ?? '')) {
    while (from < end && WORD_CHAR.test(text[from] ?? '')) from += 1;
  }
  let to = end;
  if (to < text.length && WORD_CHAR.test(text[to - 1] ?? '') && WORD_CHAR.test(text[to] ?? '')) {
    while (to > from && WORD_CHAR.test(text[to - 1] ?? '')) to -= 1;
  }
  return text.slice(from, to);
}

async function loadRuntime(repoRoot) {
  const requireFromServer = createRequire(join(repoRoot, 'packages/server/package.json'));
  const paths = {
    orama: join(repoRoot, 'packages/server/dist/memory/src/search/orama-search-service.mjs'),
    backlogHome: join(repoRoot, 'packages/server/dist/core/backlog-home.mjs'),
    wakeup: join(repoRoot, 'packages/server/dist/core/wakeup.mjs'),
    homeRegistry: join(repoRoot, 'packages/server/dist/storage/local/home-substrate-registry.mjs'),
    storageCatalog: join(repoRoot, 'packages/server/dist/storage/local/builtin-substrate-storage-catalog.mjs'),
    storage: join(repoRoot, 'packages/server/dist/storage/local/docs-native-filesystem-storage.mjs'),
    backlogService: join(repoRoot, 'packages/server/dist/storage/local/backlog-service.mjs'),
    searchDocument: join(repoRoot, 'packages/server/dist/core/substrates/create-search-entity-document.mjs'),
    resourceManager: join(repoRoot, 'packages/server/dist/resources/manager.mjs'),
    tokenizer: join(repoRoot, 'packages/memory/src/search/tokenizer.ts'),
    transformers: requireFromServer.resolve('@huggingface/transformers'),
  };
  for (const [name, path] of Object.entries(paths)) {
    if (!existsSync(path)) {
      fail(`Missing ${name} runtime at ${path}; run "pnpm build" first`);
    }
  }
  const [
    oramaModule,
    backlogHomeModule,
    wakeupModule,
    homeRegistryModule,
    storageCatalogModule,
    storageModule,
    backlogServiceModule,
    searchDocumentModule,
    resourceManagerModule,
    tokenizerModule,
    transformersModule,
  ] = await Promise.all([
    import(pathToFileURL(paths.orama).href),
    import(pathToFileURL(paths.backlogHome).href),
    import(pathToFileURL(paths.wakeup).href),
    import(pathToFileURL(paths.homeRegistry).href),
    import(pathToFileURL(paths.storageCatalog).href),
    import(pathToFileURL(paths.storage).href),
    import(pathToFileURL(paths.backlogService).href),
    import(pathToFileURL(paths.searchDocument).href),
    import(pathToFileURL(paths.resourceManager).href),
    import(pathToFileURL(paths.tokenizer).href),
    import(pathToFileURL(paths.transformers).href),
  ]);
  return {
    OramaSearchService: oramaModule.OramaSearchService,
    resolveBacklogHome: backlogHomeModule.resolveBacklogHome,
    wakeup: wakeupModule.wakeup,
    loadHomeSubstrateRegistry: homeRegistryModule.loadHomeSubstrateRegistry,
    BuiltinSubstrateStorageCatalog: storageCatalogModule.BuiltinSubstrateStorageCatalog,
    DocsNativeFilesystemStorage: storageModule.DocsNativeFilesystemStorage,
    BacklogService: backlogServiceModule.BacklogService,
    createSearchEntityDocument: searchDocumentModule.createSearchEntityDocument,
    ResourceManager: resourceManagerModule.ResourceManager,
    compoundWordTokenizer: tokenizerModule.compoundWordTokenizer,
    AutoTokenizer:
      transformersModule.AutoTokenizer
      ?? transformersModule.default?.AutoTokenizer,
  };
}

/**
 * Production-faithful corpus: the local-runtime composition (root-anchored
 * ResourceManager, claimed-entity exclusion via the scan prefix) minus the
 * suite's own output files.
 */
function loadProductCorpus(args, runtime) {
  const home = runtime.resolveBacklogHome({
    home: 'project',
    projectRoot: args.projectRoot,
  });
  const definitions = runtime.loadHomeSubstrateRegistry(
    home,
    new runtime.BuiltinSubstrateStorageCatalog(),
  );
  if (definitions.diagnostics.length > 0) {
    fail(`Project substrate diagnostics prevent the suite: ${JSON.stringify(definitions.diagnostics)}`);
  }
  const registry = definitions.registry;
  const storage = new runtime.DocsNativeFilesystemStorage(home, registry);
  const storedDocuments = Array.from(storage.iterateDocuments());
  const getSearchFields = registry.getSearchFields.bind(registry);
  const entityDocuments = storedDocuments.flatMap(function projectStoredEntity(stored) {
    const document = runtime.createSearchEntityDocument(stored.entity, getSearchFields);
    return document === undefined
      ? []
      : [{ ...document, sourcePath: stored.sourcePath }];
  });
  const resourceManager = new runtime.ResourceManager(home.root, home.documentsDir);
  const scanPrefix = resourceManager.scanPrefix;
  const entitySourcePaths = new Set(storedDocuments.map(function rootRelative(stored) {
    return scanPrefix === '' ? stored.sourcePath : `${scanPrefix}/${stored.sourcePath}`;
  }));
  const excludedPaths = new Set([
    canonicalPath(args.output),
    canonicalPath(args.summary),
  ]);
  const resources = resourceManager.list().filter(function excludeDerivedInputs(resource) {
    const absolutePath = canonicalPath(resolve(home.root, resource.path));
    return !entitySourcePaths.has(resource.path) && !excludedPaths.has(absolutePath);
  });
  const ids = new Set();
  for (const id of [
    ...entityDocuments.map(document => document.entity.id),
    ...resources.map(resource => resource.id),
  ]) {
    if (ids.has(id)) fail(`Duplicate corpus document ID: ${id}`);
    ids.add(id);
  }
  if (ids.size === 0) fail(`Project corpus is empty: ${home.documentsDir}`);
  return {
    home,
    registry,
    storage,
    resourceManager,
    entityDocuments,
    resources,
    quarantines: storage.listClaimQuarantines(),
    ids,
    excludedPaths: [...excludedPaths].sort(),
  };
}

function corpusSnapshot(entityDocuments, resources) {
  const records = [
    ...entityDocuments.map(({ sourcePath, ...document }) => ({ kind: 'entity', document })),
    ...resources.map(resource => ({ kind: 'resource', resource })),
  ].sort(function compareCorpusRecords(left, right) {
    const leftId = left.kind === 'entity' ? left.document.entity.id : left.resource.id;
    const rightId = right.kind === 'entity' ? right.document.entity.id : right.resource.id;
    return compareStrings(String(leftId), String(rightId));
  });
  return Buffer.from(records.map(stableJsonLine).join(''));
}

function countEntityTypes(entityDocuments) {
  const counts = {};
  for (const document of entityDocuments) {
    const type = String(document.entity.type);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => compareStrings(left[0], right[0])));
}

/**
 * One probe-document view per corpus member: id, type, title, searchable
 * text, plus the stored entity for frontmatter reads.
 */
function probeDocuments(corpus) {
  const documents = [];
  for (const document of corpus.entityDocuments) {
    documents.push({
      id: String(document.entity.id),
      kind: 'entity',
      type: String(document.entity.type),
      title: String(document.entity.title ?? '').trim(),
      sourcePath: document.sourcePath,
      entity: document.entity,
      searchText: entitySearchText(document),
    });
  }
  for (const resource of corpus.resources) {
    documents.push({
      id: String(resource.id),
      kind: 'resource',
      type: 'resource',
      title: String(resource.title ?? '').trim(),
      sourcePath: resource.path,
      entity: undefined,
      searchText: resourceSearchText(resource),
    });
  }
  documents.sort((left, right) => compareStrings(left.id, right.id));
  return documents;
}

/** Per-token document frequency over the whole corpus (dedup per document). */
function buildDocumentFrequency(documents, tokenizer) {
  const df = new Map();
  for (const document of documents) {
    const tokens = new Set(tokenizer.tokenize(document.searchText));
    for (const token of tokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  return df;
}

/**
 * Binary-search the character offset where the MiniLM token count of the
 * prefix first reaches `targetTokens`. Mechanical: uses the runtime's own
 * tokenizer; returns text.length when the document never reaches the target.
 */
function charOffsetAtTokenCount(text, targetTokens, countTokens) {
  if (countTokens(text) < targetTokens) return text.length;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (countTokens(text.slice(0, middle)) < targetTokens) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Mechanically extract a tail query: the N corpus-rarest tokens in the zone,
 * in order of first appearance. Tokens must carry at least one letter and be
 * at least three characters long; ties break on first appearance.
 */
function rareTailQuery(zoneText, documentFrequency) {
  const seen = new Set();
  const candidates = [];
  const words = wordSequence(zoneText);
  for (let index = 0; index < words.length; index += 1) {
    const token = words[index].toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    if (token.length < 3 || !/[a-z]/u.test(token)) continue;
    const df = documentFrequency.get(token) ?? 0;
    // A real zone word always exists in the corpus vocabulary through its
    // own document; df === 0 can only be a slicing artifact — never probe it.
    if (df === 0) continue;
    candidates.push({ token, df, position: index });
  }
  if (candidates.length === 0) return undefined;
  const selected = [...candidates]
    .sort((left, right) => (left.df - right.df) || (left.position - right.position))
    .slice(0, TAIL_QUERY_TOKENS)
    .sort((left, right) => left.position - right.position);
  return selected.map(candidate => candidate.token).join(' ');
}

/** Most corpus-frequent tokens — guaranteed-recall query text for filters. */
function frequentTokens(documentFrequency, count) {
  return [...documentFrequency.entries()]
    .filter(([token]) => token.length >= 3 && /[a-z]/u.test(token))
    .sort((left, right) => (right[1] - left[1]) || compareStrings(left[0], right[0]))
    .slice(0, count)
    .map(([token]) => token);
}

function normalizeReference(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.(md|markdown)$/u, '')
    .replace(/[-\s]+/gu, ' ');
}

/** Resolve a frontmatter supersedes reference to a corpus document. */
function resolveSupersedesReference(reference, documents) {
  const normalized = normalizeReference(reference);
  if (!normalized) return undefined;
  for (const document of documents) {
    if (normalizeReference(document.id) === normalized) return document;
    const base = document.sourcePath === undefined
      ? undefined
      : basename(document.sourcePath);
    if (base !== undefined && normalizeReference(base) === normalized) return document;
  }
  return undefined;
}

function supersedesPairs(documents) {
  const pairs = [];
  for (const document of documents) {
    if (document.entity === undefined) continue;
    const declared = document.entity.supersedes;
    if (!Array.isArray(declared)) continue;
    for (const reference of declared) {
      if (typeof reference !== 'string' || reference.trim() === '') continue;
      pairs.push({ superseding: document, reference });
    }
  }
  return pairs.sort((left, right) =>
    compareStrings(left.superseding.id, right.superseding.id)
    || compareStrings(left.reference, right.reference));
}

/** Shared-stem query: ordered intersection of the two documents' title tokens. */
function sharedStemQuery(supersedingTitle, supersededTitle, tokenizer) {
  const supersededTokens = new Set(tokenizer.tokenize(supersededTitle));
  const seen = new Set();
  const shared = [];
  for (const word of wordSequence(supersedingTitle)) {
    const token = word.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    if (supersededTokens.has(token)) shared.push(token);
  }
  return shared.join(' ');
}

class SearchProbe {
  constructor(searchService) {
    this.searchService = searchService;
    this.cache = new Map();
  }

  async run(query, options) {
    const key = JSON.stringify([query, options ?? null]);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const results = await this.searchService.searchAll(query, {
      docTypes: options?.types,
      limit: options?.limit ?? MEMBERSHIP_WINDOW,
      sort: 'relevant',
      filters: {},
    });
    const ranked = results.map(result => ({ id: String(result.id), type: String(result.type) }));
    this.cache.set(key, ranked);
    return ranked;
  }
}

function rankOf(ranked, id) {
  const index = ranked.findIndex(result => result.id === id);
  return index === -1 ? null : index + 1;
}

/** Build every search-dependent assertion for one mode. */
async function runSearchAssertions({
  mode,
  probe,
  documents,
  documentFrequency,
  tokenizer,
  miniLmZones,
  corpusTypes,
}) {
  const assertions = [];
  const skipped = [];

  const titleCounts = new Map();
  for (const document of documents) {
    const key = document.title.toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }

  const searchable = documents.filter(document => document.type !== 'memory');
  for (const document of documents) {
    if (document.type === 'memory') {
      skipped.push({
        class: 'navigation-title',
        document_id: document.id,
        reason: 'memory entities are excluded from generic search (ADR 0092.3)',
      });
    }
  }

  // navigation-title + membership-title share one search call per document.
  for (const document of searchable) {
    if (document.title === '') {
      skipped.push({
        class: 'navigation-title',
        document_id: document.id,
        reason: 'document has no title to probe',
      });
      continue;
    }
    const ranked = await probe.run(document.title, { limit: MEMBERSHIP_WINDOW });
    const rank = rankOf(ranked, document.id);
    const unique = (titleCounts.get(document.title.toLowerCase()) ?? 0) === 1;
    assertions.push({
      class: 'navigation-title',
      document_id: document.id,
      query: document.title,
      target_unique_title: unique,
      rank,
      success_at_1: rank === 1,
      pass: rank !== null && rank <= NAVIGATION_WINDOW,
    });
    assertions.push({
      class: 'membership-title',
      document_id: document.id,
      query: document.title,
      rank,
      pass: rank !== null && rank <= MEMBERSHIP_WINDOW,
    });
  }

  // navigation-id: entities only, both separator families.
  for (const document of searchable) {
    if (document.kind !== 'entity') continue;
    for (const { form, query } of idQueryForms(document.id)) {
      const ranked = await probe.run(query, { limit: MEMBERSHIP_WINDOW });
      const rank = rankOf(ranked, document.id);
      assertions.push({
        class: 'navigation-id',
        document_id: document.id,
        id_form: form,
        query,
        rank,
        success_at_1: rank === 1,
        pass: rank !== null && rank <= NAVIGATION_WINDOW,
      });
    }
  }

  // filter-compliance: high-frequency query text, one type filter at a time.
  const filterQueries = frequentTokens(documentFrequency, FILTER_QUERIES_PER_TYPE);
  for (const type of corpusTypes) {
    for (const query of filterQueries) {
      const ranked = await probe.run(query, { types: [type], limit: MEMBERSHIP_WINDOW });
      const violations = ranked.filter(result => result.type !== type);
      assertions.push({
        class: 'filter-compliance',
        type,
        query,
        result_count: ranked.length,
        pass: violations.length === 0 && ranked.length <= MEMBERSHIP_WINDOW,
        ...(violations.length === 0 ? {} : { violations }),
      });
    }
  }

  // supersedes-ordering.
  for (const { superseding, reference } of supersedesPairs(documents)) {
    const superseded = resolveSupersedesReference(reference, documents);
    assertions.push({
      class: 'supersedes-reference-resolves',
      document_id: superseding.id,
      reference,
      resolved_id: superseded?.id ?? null,
      pass: superseded !== undefined,
    });
    if (superseded === undefined) continue;
    const query = sharedStemQuery(superseding.title, superseded.title, tokenizer);
    if (query === '') {
      skipped.push({
        class: 'supersedes-ordering',
        document_id: superseding.id,
        reason: `no shared title tokens with ${superseded.id}`,
      });
      continue;
    }
    const ranked = await probe.run(query, { limit: ORDERING_WINDOW });
    const supersedingRank = rankOf(ranked, superseding.id);
    const supersededRank = rankOf(ranked, superseded.id);
    const bothAbsent = supersedingRank === null && supersededRank === null;
    assertions.push({
      class: 'supersedes-ordering',
      superseding_id: superseding.id,
      superseded_id: superseded.id,
      query,
      superseding_rank: supersedingRank,
      superseded_rank: supersededRank,
      ...(bothAbsent ? { reason: 'neither document in the top-' + ORDERING_WINDOW + ' window' } : {}),
      pass: !bothAbsent
        && (supersededRank === null
          || (supersedingRank !== null && supersedingRank <= supersededRank)),
    });
  }

  // tail-reachability.
  for (const document of searchable) {
    const zones = miniLmZones.get(document.id) ?? [];
    for (const zone of zones) {
      const query = rareTailQuery(zone.text, documentFrequency);
      if (query === undefined) {
        skipped.push({
          class: 'tail-reachability',
          document_id: document.id,
          reason: `zone ${zone.zone} has no probe-eligible tokens`,
        });
        continue;
      }
      const ranked = await probe.run(query, { limit: MEMBERSHIP_WINDOW });
      const rank = rankOf(ranked, document.id);
      assertions.push({
        class: 'tail-reachability',
        document_id: document.id,
        zone: zone.zone,
        query,
        rank,
        pass: rank !== null && rank <= TAIL_WINDOW,
      });
    }
  }

  return { mode, assertions, skipped };
}

/**
 * Wakeup reconciliation and quarantine visibility — mode-independent
 * composition checks through the real wakeup fold over the real service.
 */
async function runCompositionAssertions(corpus, runtime, searchService) {
  const registry = corpus.registry;
  const service = new runtime.BacklogService({
    storage: corpus.storage,
    search: searchService,
    resourceManager: corpus.resourceManager,
    getSearchFields: registry.getSearchFields.bind(registry),
    allocateId: function refuseAllocation() {
      fail('The structural suite is read-only; no ID allocation is permitted');
    },
    listDisclosureRelations: registry.listDisclosureRelations.bind(registry),
    listWakeupDisclosures: function listWakeupDisclosures() {
      return registry.listSubstrates().flatMap(function toSection(substrate) {
        const wakeup = registry.getDisclosure(substrate.storageClaim.type)?.wakeup;
        return wakeup === undefined
          ? []
          : [{ type: substrate.storageClaim.type, wakeup }];
      });
    },
  });
  const briefing = await runtime.wakeup(service, {});

  const assertions = [];
  const declaredSections = service.listWakeupDisclosures()
    .filter(declared => declared.wakeup.section !== 'constraints');
  for (const declared of declaredSections) {
    const section = declared.wakeup.section;
    const includeTokens = declared.wakeup.includeStatuses
      .map(status => (typeof status === 'string' ? leadingStatusToken(status) : status));
    const eligible = corpus.entityDocuments
      .filter(document => String(document.entity.type) === declared.type)
      .filter(document => {
        if (declared.wakeup.includeStatuses.length === 0) return true;
        const token = leadingStatusToken(document.entity.status);
        return includeTokens.some(include =>
          typeof include === 'string'
            ? token !== undefined && token === include
            : document.entity.status !== undefined && document.entity.status === include);
      })
      .map(document => String(document.entity.id))
      .sort(compareStrings);
    const stubs = briefing.sections[section] ?? [];
    const omitted = briefing.metadata.sections_omitted[section] ?? 0;
    const disclosed = stubs.length + omitted;
    assertions.push({
      class: 'wakeup-reconciliation',
      section,
      type: declared.type,
      include_statuses: declared.wakeup.includeStatuses,
      eligible_count: eligible.length,
      disclosed_count: disclosed,
      disclosed_stub_ids: stubs.map(stub => String(stub.id)),
      omitted_count: omitted,
      pass: disclosed === eligible.length,
      ...(disclosed === eligible.length ? {} : { eligible_ids: eligible }),
    });
  }

  const namedQuarantines = new Set(
    (briefing.metadata.quarantined ?? []).map(entry => `${entry.type}\0${entry.path}`),
  );
  for (const quarantine of [...corpus.quarantines].sort((left, right) =>
    compareStrings(left.sourcePath, right.sourcePath))) {
    assertions.push({
      class: 'quarantine-visibility',
      type: quarantine.type,
      source_path: quarantine.sourcePath,
      reason: quarantine.reason,
      pass: namedQuarantines.has(`${quarantine.type}\0${quarantine.sourcePath}`),
    });
  }

  return assertions;
}

function summarizeAssertions(assertions) {
  const byClass = {};
  for (const assertion of assertions) {
    const entry = byClass[assertion.class] ?? { total: 0, passed: 0, failed: 0 };
    entry.total += 1;
    if (assertion.pass) entry.passed += 1;
    else entry.failed += 1;
    byClass[assertion.class] = entry;
  }
  return Object.fromEntries(
    Object.entries(byClass).sort((left, right) => compareStrings(left[0], right[0])),
  );
}

function failuresOf(assertions) {
  return assertions.filter(assertion => !assertion.pass);
}

function writeFileAtomically(outputPath, content) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' });
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function assertionLabel(assertion) {
  return assertion.document_id
    ?? assertion.superseding_id
    ?? assertion.section
    ?? assertion.source_path
    ?? assertion.type;
}

function renderSummary(report) {
  const lines = [];
  lines.push('# Structural Truth Suite — Run Summary');
  lines.push('');
  lines.push(`Corpus: ${report.inputs.corpus.count} documents `
    + `(${report.inputs.corpus.entity_count} entities, `
    + `${report.inputs.corpus.resource_count} resources, `
    + `${report.inputs.corpus.quarantined_count} quarantined) — `
    + `sha256 \`${report.inputs.corpus.sha256.slice(0, 12)}…\`, `
    + `commit \`${report.provenance.git_commit.slice(0, 12)}\`.`);
  lines.push('');
  lines.push('## Declared limits');
  lines.push('');
  for (const limit of report.declared_limits) {
    lines.push(`- ${limit}`);
  }
  lines.push('');
  lines.push('## Composition (mode-independent)');
  lines.push('');
  for (const assertion of report.composition.assertions) {
    if (assertion.class === 'wakeup-reconciliation') {
      lines.push(`- ${assertion.pass ? 'PASS' : 'FAIL'} wakeup-reconciliation `
        + `[${assertion.section}]: disclosed ${assertion.disclosed_count} `
        + `vs eligible ${assertion.eligible_count}`);
    } else {
      lines.push(`- ${assertion.pass ? 'PASS' : 'FAIL'} ${assertion.class}: `
        + `${assertion.source_path ?? ''}`);
    }
  }
  lines.push('');
  for (const [mode, modeReport] of Object.entries(report.modes)) {
    lines.push(`## Mode: ${mode}`);
    lines.push('');
    lines.push('| class | total | passed | failed |');
    lines.push('|---|---|---|---|');
    for (const [name, counts] of Object.entries(modeReport.assertion_counts)) {
      lines.push(`| ${name} | ${counts.total} | ${counts.passed} | ${counts.failed} |`);
    }
    lines.push('');
    const failures = failuresOf(modeReport.assertions);
    if (failures.length === 0) {
      lines.push('No failures. Retrievability holds for every probed document '
        + 'in this mode (ADR 0121 falsifiability clause: an all-green run '
        + 'closes retrievability as a failure class for this corpus).');
    } else {
      lines.push(`### Failures (${failures.length})`);
      lines.push('');
      for (const failure of failures) {
        const rank = failure.rank === undefined
          ? ''
          : failure.rank === null ? ' — not in window' : ` — rank ${failure.rank}`;
        lines.push(`- ${failure.class}: ${assertionLabel(failure)} `
          + `(query: \`${failure.query ?? ''}\`)${rank}`);
      }
    }
    if (modeReport.skipped.length > 0) {
      lines.push('');
      lines.push(`Skipped probes: ${modeReport.skipped.length} (enumerated in the JSON report).`);
    }
    lines.push('');
  }
  lines.push('## Totals');
  lines.push('');
  lines.push(`Assertions: ${report.totals.assertions}, `
    + `passed: ${report.totals.passed}, failed: ${report.totals.failed}.`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = await loadRuntime(repoRoot);
  if (runtime.AutoTokenizer === undefined) {
    fail('Cannot resolve AutoTokenizer from @huggingface/transformers');
  }
  const corpus = loadProductCorpus(args, runtime);
  const corpusInput = corpusSnapshot(corpus.entityDocuments, corpus.resources);
  const documents = probeDocuments(corpus);
  const tokenizer = runtime.compoundWordTokenizer;
  const documentFrequency = buildDocumentFrequency(documents, tokenizer);

  // MiniLM tail zones (declared token offsets: 257–512 and >512).
  const miniLm = await runtime.AutoTokenizer.from_pretrained(MODEL_ID);
  const countTokens = text => miniLm.encode(text).length;
  const miniLmZones = new Map();
  for (const document of documents) {
    const text = document.searchText;
    const totalTokens = countTokens(text);
    if (totalTokens <= TRAINED_WINDOW_TOKENS) continue;
    const trainedBoundary = charOffsetAtTokenCount(text, TRAINED_WINDOW_TOKENS + 1, countTokens);
    const runtimeBoundary = charOffsetAtTokenCount(text, RUNTIME_WINDOW_TOKENS + 1, countTokens);
    const zones = [];
    const degradedText = snapSlice(text, trainedBoundary, runtimeBoundary);
    if (wordSequence(degradedText).length >= TAIL_MINIMUM_ZONE_WORDS) {
      zones.push({ zone: 'tokens-257-512', text: degradedText });
    }
    if (totalTokens > RUNTIME_WINDOW_TOKENS) {
      const absentText = snapSlice(text, runtimeBoundary, text.length);
      if (wordSequence(absentText).length >= TAIL_MINIMUM_ZONE_WORDS) {
        zones.push({ zone: 'tokens-beyond-512', text: absentText });
      }
    }
    if (zones.length > 0) miniLmZones.set(document.id, zones);
  }

  const corpusTypes = [
    ...Object.keys(countEntityTypes(corpus.entityDocuments)).filter(type => type !== 'memory'),
    ...(corpus.resources.length > 0 ? ['resource'] : []),
  ].sort(compareStrings);

  const suiteDirectory = join(
    tmpdir(),
    `backlog-mcp-structural-suite-${process.pid}`,
  );
  mkdirSync(suiteDirectory, { recursive: true });
  try {
    const modeReports = {};
    let compositionAssertions;
    for (const mode of args.modes) {
      const hybridSearch = mode === 'hybrid';
      const searchService = new runtime.OramaSearchService({
        cachePath: join(suiteDirectory, `${mode}-index.json`),
        hybridSearch,
      });
      await searchService.index(corpus.entityDocuments.map(({ sourcePath, ...document }) => document));
      await searchService.reconcileResources(corpus.resources);
      searchService.flush();
      if (hybridSearch && !searchService.isHybridSearchActive()) {
        fail('MiniLM hybrid initialization failed; refusing to record BM25 fallback as hybrid evidence');
      }
      if (compositionAssertions === undefined) {
        compositionAssertions = await runCompositionAssertions(corpus, runtime, searchService);
      }
      const probe = new SearchProbe(searchService);
      const { assertions, skipped } = await runSearchAssertions({
        mode,
        probe,
        documents,
        documentFrequency,
        tokenizer,
        miniLmZones,
        corpusTypes,
      });
      modeReports[mode] = {
        hybrid_active: searchService.isHybridSearchActive(),
        assertion_counts: summarizeAssertions(assertions),
        skipped,
        assertions,
      };
    }

    const allAssertions = [
      ...(compositionAssertions ?? []),
      ...Object.values(modeReports).flatMap(modeReport => modeReport.assertions),
    ];
    const report = {
      schema_version: 1,
      runner: 'scripts/structural-suite.mjs',
      ruling: 'ADR 0121 R2 — the structural truth suite is the deterministic instrument',
      assessor: 'constructive:structural-suite',
      declared_limits: DECLARED_LIMITS,
      determinism_contract: 'This report contains no timestamps or timings; two runs over the same corpus and commit must be byte-identical.',
      inputs: {
        corpus: {
          project_root: corpus.home.root,
          documents_dir: corpus.home.documentsDir,
          home_id: corpus.home.id,
          sha256: sha256(corpusInput),
          count: corpus.ids.size,
          entity_count: corpus.entityDocuments.length,
          resource_count: corpus.resources.length,
          quarantined_count: corpus.quarantines.length,
          entity_types: countEntityTypes(corpus.entityDocuments),
          excluded_paths: corpus.excludedPaths,
        },
      },
      probes: {
        navigation_window: NAVIGATION_WINDOW,
        membership_window: MEMBERSHIP_WINDOW,
        ordering_window: ORDERING_WINDOW,
        tail_window: TAIL_WINDOW,
        tail_zone_model: {
          id: MODEL_ID,
          trained_window_tokens: TRAINED_WINDOW_TOKENS,
          runtime_window_tokens: RUNTIME_WINDOW_TOKENS,
        },
        tail_documents_probed: miniLmZones.size,
        filter_query_tokens: frequentTokens(documentFrequency, FILTER_QUERIES_PER_TYPE),
        filter_types: corpusTypes,
      },
      provenance: {
        git_commit: gitCommit(repoRoot),
        runner_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      },
      composition: {
        assertions: compositionAssertions ?? [],
        assertion_counts: summarizeAssertions(compositionAssertions ?? []),
      },
      modes: modeReports,
      totals: {
        assertions: allAssertions.length,
        passed: allAssertions.filter(assertion => assertion.pass).length,
        failed: allAssertions.filter(assertion => !assertion.pass).length,
      },
    };
    writeFileAtomically(args.output, `${JSON.stringify(report, null, 2)}\n`);
    writeFileAtomically(args.summary, renderSummary(report));
    process.stdout.write(`Structural truth suite report: ${args.output}\n`);
    process.stdout.write(`Summary: ${args.summary}\n`);
    process.stdout.write(`Assertions: ${report.totals.assertions}, failed: ${report.totals.failed}\n`);
  } finally {
    rmSync(suiteDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`suite:structural: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
