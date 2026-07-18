#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import os from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const HELP = `Usage:
  pnpm search:eval -- \\
    --project-root <project> \\
    --queries <queries.jsonl> \\
    --qrels <qrels.jsonl> \\
    --output <report.json> \\
    [--summary <summary.md>] \\
    [--baseline-version N] \\
    [--warmups N] \\
    [--repetitions N]

Required:
  --project-root Docs-native project whose production search corpus is measured;
                 also the PROJECT home for recall queries whose options.home
                 is "project" (their options.home "global" home is always the
                 user's real global home, resolved the same way the CLI does)
  --queries      One judged search/recall query per line
  --qrels        One graded relevance judgment per line
  --output       Durable JSON report destination

Optional:
  --summary      Human-readable Markdown summary destination. Required when
                 every query is a "recall" query carrying options.home — that
                 run scores the per-home recall path instead of the
                 search/hybrid benchmark below and emits this summary too.
  --baseline-version Evidence version (default: 1; v1 is search-only)
  --warmups      Full-query-set warmup passes (default: 1)
  --repetitions  Measured full-query-set passes (default: 3)
  --help         Show this help

Run "pnpm build" before executing a benchmark.
`;

const REQUIRED_ARGUMENTS = ['project-root', 'queries', 'qrels', 'output'];
const VALUE_ARGUMENTS = new Set([
  ...REQUIRED_ARGUMENTS,
  'summary',
  'baseline-version',
  'warmups',
  'repetitions',
]);
const MEMORY_LAYERS = new Set(['episodic', 'semantic', 'procedural']);
const MODEL_METADATA = {
  id: 'Xenova/all-MiniLM-L6-v2',
  revision: 'default-main-unpinned',
  dimensions: 384,
  dtype: 'fp32',
  max_tokens: 512,
  trained_window_tokens: 256,
  document_prefix: '',
  query_prefix: '',
  pooling: 'mean',
  post_pool_transform: 'none',
  normalize: true,
};
const REQUIRED_MODEL_CACHE_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model.onnx',
];

function fail(message) {
  throw new Error(message);
}

function canonicalPath(filePath) {
  const absolutePath = resolve(filePath);
  if (existsSync(absolutePath)) return realpathSync(absolutePath);
  const parentPath = dirname(absolutePath);
  if (parentPath === absolutePath) return absolutePath;
  return join(canonicalPath(parentPath), basename(absolutePath));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value, location) {
  if (!isRecord(value)) fail(`${location} must be a JSON object`);
  return value;
}

function requireString(value, location) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${location} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value, location) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    fail(`${location} must be an array of non-empty strings`);
  }
  return value;
}

function requireNonEmptyStringArray(value, location) {
  const values = requireStringArray(value, location);
  if (values.length === 0) fail(`${location} must not be empty`);
  return values;
}

/**
 * Assessor tier validation (ADR 0121 R9; JUDGING.md "Assessor tiers").
 *
 * Replaces the former `includes('reviewed:')` substring check, which nine
 * characters satisfied regardless of who actually reviewed (report 0004,
 * lens A). Every semicolon-separated assessor entry must declare its tier:
 *
 *   constructive:<generator>  truth by construction — no reviewer exists
 *   human:<name>              a human assessor of record
 *   llm:<agent-or-model>      provisional — never gates alone
 *
 * Fleet persona names are the llm tier: naming an agent does not make a
 * human. A judgment's tier is its strongest entry (constructive > human >
 * llm); llm-tier judgments are accepted as input but mark the whole report
 * gate-ineligible until a human assessor of record confirms them.
 */
const ASSESSOR_TIERS = new Set(['constructive', 'human', 'llm']);

function requireTieredAssessor(value, location) {
  const assessor = requireString(value, location);
  const entries = assessor.split(';').map(entry => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    fail(`${location} must contain at least one tiered assessor entry`);
  }
  const tiers = [];
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    const tier = separator === -1 ? '' : entry.slice(0, separator).trim();
    const detail = separator === -1 ? '' : entry.slice(separator + 1).trim();
    if (!ASSESSOR_TIERS.has(tier)) {
      fail(`${location} entry "${entry}" must declare an assessor tier `
        + '("constructive:", "human:", or "llm:" — see docs/evaluation/JUDGING.md)');
    }
    if (detail === '') {
      fail(`${location} entry "${entry}" must name its assessor of record`);
    }
    tiers.push(tier);
  }
  return { assessor, tier: judgmentTier(tiers) };
}

function judgmentTier(tiers) {
  if (tiers.includes('constructive')) return 'constructive';
  if (tiers.includes('human')) return 'human';
  return 'llm';
}

function countTiers(records) {
  const counts = { constructive: 0, human: 0, llm: 0 };
  for (const record of records) counts[record.assessor_tier] += 1;
  return counts;
}

/**
 * A report gates only when every judgment is constructively true or carries
 * a human assessor of record. llm-tier judgments are recorded evidence, not
 * gate authority (JUDGING.md "LLM-proposed judgments"; ADR 0121 R9).
 */
function gateEligibility(queries, qrels) {
  const llmJudged = [...queries, ...qrels]
    .some(record => record.assessor_tier === 'llm');
  return {
    eligible: !llmJudged,
    rule: 'JUDGING.md assessor tiers: constructively-true assertions gate by construction; human-tier judgments gate; llm-tier judgments never gate alone.',
    ...(llmJudged
      ? {
          reason: 'llm-tier judgments present without a human assessor of record; this report is recorded evidence and does not gate alone until ADR 0121 R8 human review executes.',
        }
      : {}),
  };
}

function requirePositiveInteger(value, name, defaultValue) {
  if (value === undefined) return defaultValue;
  if (!/^\d+$/.test(value)) fail(`--${name} must be a positive integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail(`--${name} must be a positive integer`);
  }
  return parsed;
}

function requireNonnegativeInteger(value, name, defaultValue) {
  if (value === undefined) return defaultValue;
  if (!/^\d+$/.test(value)) fail(`--${name} must be a nonnegative integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) fail(`--${name} must be a nonnegative integer`);
  return parsed;
}

function parseArguments(argv) {
  if (argv.includes('--help')) return { help: true };
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
  for (const name of REQUIRED_ARGUMENTS) {
    if (values[name] === undefined) fail(`Missing required option: --${name}`);
  }
  return {
    help: false,
    projectRoot: resolve(values['project-root']),
    queries: resolve(values.queries),
    qrels: resolve(values.qrels),
    output: resolve(values.output),
    summary: values.summary === undefined ? undefined : resolve(values.summary),
    baselineVersion: requirePositiveInteger(
      values['baseline-version'],
      'baseline-version',
      1,
    ),
    warmups: requireNonnegativeInteger(values.warmups, 'warmups', 1),
    repetitions: requirePositiveInteger(values.repetitions, 'repetitions', 3),
  };
}

function readJsonLines(path, label) {
  let raw;
  try {
    raw = readFileSync(path);
  } catch (error) {
    fail(`Cannot read ${label} file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const records = [];
  const lines = raw.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      fail(`${label} ${path}:${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (records.length === 0) fail(`${label} file ${path} contains no JSON records`);
  return { raw, records };
}

function validateLimit(value, location) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${location} must be a positive integer`);
  return value;
}

function validateSearchOptions(value, location) {
  const options = requireRecord(value, location);
  const validated = {};
  if (options.types !== undefined) {
    validated.types = requireStringArray(options.types, `${location}.types`);
  }
  if (options.status !== undefined) {
    validated.status = requireStringArray(options.status, `${location}.status`);
  }
  if (options.parent_id !== undefined) {
    validated.parent_id = requireString(options.parent_id, `${location}.parent_id`);
  }
  if (options.limit !== undefined) validated.limit = validateLimit(options.limit, `${location}.limit`);
  const allowed = new Set(['types', 'status', 'parent_id', 'limit']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`${location} contains unsupported field "${key}"`);
  }
  return validated;
}

/**
 * Recall-surface homes (ADR 0121 R8): a query targets exactly one production
 * home, resolved the same way `backlog recall --home <home>` resolves it
 * (packages/server/src/core/backlog-home.ts). Unlike search's single
 * `--project-root` corpus, recall queries carry their own home so one query
 * set can span both the global memory corpus and a project's.
 */
const RECALL_HOMES = new Set(['global', 'project']);

function validateRecallOptions(value, location) {
  const options = requireRecord(value, location);
  const validated = {};
  if (options.layers !== undefined) {
    const layers = requireStringArray(options.layers, `${location}.layers`);
    for (const layer of layers) {
      if (!MEMORY_LAYERS.has(layer)) {
        fail(`${location}.layers contains unsupported value "${layer}"`);
      }
    }
    validated.layers = layers;
  }
  if (options.context !== undefined) {
    validated.context = requireString(options.context, `${location}.context`);
  }
  if (options.tags !== undefined) validated.tags = requireStringArray(options.tags, `${location}.tags`);
  if (options.limit !== undefined) validated.limit = validateLimit(options.limit, `${location}.limit`);
  if (options.home !== undefined) {
    const home = requireString(options.home, `${location}.home`);
    if (!RECALL_HOMES.has(home)) {
      fail(`${location}.home must be "global" or "project"`);
    }
    validated.home = home;
  }
  const allowed = new Set(['layers', 'context', 'tags', 'limit', 'home']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`${location} contains unsupported field "${key}"`);
  }
  return validated;
}

function validateQueries(records) {
  const queries = [];
  const ids = new Set();
  records.forEach((raw, index) => {
    const location = `queries line ${index + 1}`;
    const query = requireRecord(raw, location);
    const id = requireString(query.id, `${location}.id`);
    if (ids.has(id)) fail(`Duplicate query ID: ${id}`);
    ids.add(id);
    const surface = requireString(query.surface, `${location}.surface`);
    if (surface !== 'search' && surface !== 'recall') {
      fail(`${location}.surface must be "search" or "recall"`);
    }
    const assessor = requireTieredAssessor(query.assessor, `${location}.assessor`);
    queries.push({
      id,
      class: requireString(query.class, `${location}.class`),
      surface,
      query: requireString(query.query, `${location}.query`),
      ...(query.options === undefined
        ? {}
        : {
            options: surface === 'search'
              ? validateSearchOptions(query.options, `${location}.options`)
              : validateRecallOptions(query.options, `${location}.options`),
          }),
      assessor: assessor.assessor,
      assessor_tier: assessor.tier,
      rationale: requireString(query.rationale, `${location}.rationale`),
      provenance: requireNonEmptyStringArray(query.provenance, `${location}.provenance`),
    });
  });
  return queries;
}

/**
 * Validate qrel records against a caller-supplied document universe.
 *
 * `isKnownDocument(documentId, queryId)` abstracts over where that universe
 * comes from: a single flat corpus (existing search/recall runs, one
 * `--project-root`) or a per-home lookup (per-home recall, ADR 0121 R8) —
 * two homes can mint the same MEMO- id independently, so membership must be
 * checked against the specific home the qrel's query targets, never a
 * union of every home's ids.
 */
function validateQrels(records, queryIds, isKnownDocument) {
  const qrels = [];
  const pairs = new Set();
  records.forEach((raw, index) => {
    const location = `qrels line ${index + 1}`;
    const qrel = requireRecord(raw, location);
    const queryId = requireString(qrel.query_id, `${location}.query_id`);
    const documentId = requireString(qrel.document_id, `${location}.document_id`);
    if (!queryIds.has(queryId)) fail(`${location} references unknown query "${queryId}"`);
    if (!isKnownDocument(documentId, queryId)) fail(`${location} references unknown document "${documentId}"`);
    const pair = `${queryId}\0${documentId}`;
    if (pairs.has(pair)) fail(`Duplicate qrel pair: ${queryId} / ${documentId}`);
    pairs.add(pair);
    if (!Number.isInteger(qrel.grade) || qrel.grade < 0 || qrel.grade > 3) {
      fail(`${location}.grade must be one of 0, 1, 2, or 3`);
    }
    const assessor = requireTieredAssessor(qrel.assessor, `${location}.assessor`);
    qrels.push({
      query_id: queryId,
      document_id: documentId,
      grade: qrel.grade,
      assessor: assessor.assessor,
      assessor_tier: assessor.tier,
      rationale: requireString(qrel.rationale, `${location}.rationale`),
    });
  });
  for (const queryId of queryIds) {
    if (!qrels.some(qrel => qrel.query_id === queryId)) {
      fail(`Query "${queryId}" has no qrels`);
    }
  }
  return qrels;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function stableJsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function corpusSnapshot(entityDocuments, resources) {
  const records = [
    ...entityDocuments.map(function entityRecord(document) {
      return { kind: 'entity', document };
    }),
    ...resources.map(function resourceRecord(resource) {
      return { kind: 'resource', resource };
    }),
  ].sort(function compareCorpusRecords(left, right) {
    const leftId = left.kind === 'entity' ? left.document.entity.id : left.resource.id;
    const rightId = right.kind === 'entity' ? right.document.entity.id : right.resource.id;
    const leftKey = String(leftId);
    const rightKey = String(rightId);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return Buffer.from(records.map(stableJsonLine).join(''));
}

function countEntityTypes(entityDocuments) {
  const counts = {};
  for (const document of entityDocuments) {
    const type = String(document.entity.type);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(function compareTypes(left, right) {
    return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
  }));
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

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(fraction * ordered.length) - 1);
  return ordered[Math.max(0, index)] ?? 0;
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}

function durationMilliseconds(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function recordRss(samples, phase) {
  samples.push({ phase, bytes: process.memoryUsage().rss });
}

function fileBytes(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function packageRoot(requireFromServer, packageName) {
  try {
    const packagePath = requireFromServer.resolve(`${packageName}/package.json`);
    return dirname(packagePath);
  } catch {
    try {
      let current = dirname(requireFromServer.resolve(packageName));
      while (current !== dirname(current)) {
        const packagePath = join(current, 'package.json');
        if (existsSync(packagePath)) {
          const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
          if (packageJson.name === packageName) return current;
        }
        current = dirname(current);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}

function readPackageVersion(requireFromServer, packageName) {
  const root = packageRoot(requireFromServer, packageName);
  if (root === undefined) return 'unknown';
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function directoryBytes(path) {
  if (!existsSync(path)) return 0;
  let bytes = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    bytes += entry.isDirectory() ? directoryBytes(entryPath) : fileBytes(entryPath);
  }
  return bytes;
}

function modelCacheSnapshot(cacheDir) {
  const path = join(cacheDir, ...MODEL_METADATA.id.split('/'));
  const requiredFiles = Object.fromEntries(REQUIRED_MODEL_CACHE_FILES.map(
    function modelFile(relativePath) {
      const absolutePath = join(path, ...relativePath.split('/'));
      return [relativePath, existsSync(absolutePath) ? sha256(readFileSync(absolutePath)) : null];
    },
  ));
  return {
    path,
    bytes: directoryBytes(path),
    complete: Object.values(requiredFiles).every(hash => hash !== null),
    required_file_sha256: requiredFiles,
  };
}

function assertModelMetadata(repoRoot) {
  const source = readFileSync(
    join(repoRoot, 'packages/memory/src/search/embedding-service.ts'),
    'utf8',
  );
  const expectedSource = [
    `const MODEL_ID = '${MODEL_METADATA.id}'`,
    `export const EMBEDDING_DIMENSIONS = ${MODEL_METADATA.dimensions}`,
    `dtype: '${MODEL_METADATA.dtype}'`,
    `pooling: '${MODEL_METADATA.pooling}'`,
    `normalize: ${String(MODEL_METADATA.normalize)}`,
  ];
  for (const fragment of expectedSource) {
    if (!source.includes(fragment)) {
      fail(`Runner model metadata drifted from embedding-service.ts: ${fragment}`);
    }
  }
}

function assertRuntimeTokenBoundary(modelPath) {
  const tokenizerConfig = JSON.parse(
    readFileSync(join(modelPath, 'tokenizer_config.json'), 'utf8'),
  );
  const modelConfig = JSON.parse(
    readFileSync(join(modelPath, 'config.json'), 'utf8'),
  );
  if (
    tokenizerConfig.model_max_length !== MODEL_METADATA.max_tokens
    || modelConfig.max_position_embeddings !== MODEL_METADATA.max_tokens
  ) {
    fail('Runner max_tokens drifted from the cached tokenizer/model boundary');
  }
}

function buildEnvironment(repoRoot) {
  const requireFromServer = createRequire(join(repoRoot, 'packages/server/package.json'));
  const transformersRequire = createRequire(requireFromServer.resolve('@huggingface/transformers'));
  const serverPackage = JSON.parse(readFileSync(join(repoRoot, 'packages/server/package.json'), 'utf8'));
  const memoryPackage = JSON.parse(readFileSync(join(repoRoot, 'packages/memory/package.json'), 'utf8'));
  const cpus = os.cpus();
  const firstCpu = cpus[0];
  return {
    node: process.version,
    platform: process.platform,
    os_release: os.release(),
    arch: process.arch,
    cpu: firstCpu?.model ?? 'unknown',
    cpu_count: cpus.length,
    ram_bytes: os.totalmem(),
    packages: {
      'backlog-mcp': serverPackage.version ?? 'unknown',
      '@backlog-mcp/memory': memoryPackage.version ?? 'unknown',
      '@huggingface/transformers': readPackageVersion(requireFromServer, '@huggingface/transformers'),
      '@orama/orama': readPackageVersion(requireFromServer, '@orama/orama'),
      'onnxruntime-node': readPackageVersion(transformersRequire, 'onnxruntime-node'),
    },
  };
}

class BenchmarkServiceAdapter {
  constructor(searchService) {
    this.searchService = searchService;
  }

  async searchUnified(query, options) {
    const results = await this.searchService.searchAll(query, {
      docTypes: options?.types,
      limit: options?.limit ?? 20,
      sort: options?.sort === 'recent' ? 'recent' : 'relevant',
      filters: {
        status: options?.status,
        parent_id: options?.parent_id,
      },
    });
    return results.map(result => ({
      item: result.item,
      score: result.score,
      type: result.type,
      snippet: result.snippet,
    }));
  }
}

function groupJudgments(qrels) {
  const grouped = new Map();
  for (const qrel of qrels) {
    const current = grouped.get(qrel.query_id) ?? [];
    current.push({ id: qrel.document_id, grade: qrel.grade });
    grouped.set(qrel.query_id, current);
  }
  return grouped;
}

async function retrieve(query, adapter, memoryStore) {
  if (query.surface === 'recall') {
    const results = await memoryStore.recall({
      query: query.query,
      limit: query.options?.limit ?? 20,
      layers: query.options?.layers,
      context: query.options?.context,
      tags: query.options?.tags,
    });
    return results.map(result => result.entry.id);
  }
  const results = await adapter.searchUnified(query.query, {
    types: query.options?.types,
    status: query.options?.status,
    parent_id: query.options?.parent_id,
    limit: query.options?.limit ?? 20,
  });
  return results.map(result => result.item.id);
}

async function runQuerySet(queries, adapter, memoryStore) {
  const results = [];
  for (const query of queries) {
    const start = process.hrtime.bigint();
    const rankedIds = await retrieve(query, adapter, memoryStore);
    results.push({
      query_id: query.id,
      ranked_ids: rankedIds,
      duration_ms: roundMilliseconds(durationMilliseconds(start)),
    });
  }
  return results;
}

function summarizeMode(queries, measuredRuns, judgmentsByQuery, metrics) {
  const firstRun = measuredRuns[0] ?? [];
  const firstById = new Map(firstRun.map(result => [result.query_id, result]));
  const timingsById = new Map();
  for (const run of measuredRuns) {
    for (const result of run) {
      const values = timingsById.get(result.query_id) ?? [];
      values.push(result.duration_ms);
      timingsById.set(result.query_id, values);
    }
  }

  const perQuery = queries.map(query => {
    const first = firstById.get(query.id);
    if (!first) fail(`Missing measured result for query "${query.id}"`);
    const timings = timingsById.get(query.id) ?? [];
    const deterministic = measuredRuns.every(run => {
      const result = run.find(candidate => candidate.query_id === query.id);
      return JSON.stringify(result?.ranked_ids ?? []) === JSON.stringify(first.ranked_ids);
    });
    const judgments = judgmentsByQuery.get(query.id) ?? [];
    return {
      query_id: query.id,
      class: query.class,
      surface: query.surface,
      ranked_ids: first.ranked_ids,
      timings_ms: timings,
      deterministic,
      metrics: metrics.evaluateQuery(first.ranked_ids, judgments),
      unjudged_at_10: metrics.unjudgedRateAt(first.ranked_ids, judgments, 10),
    };
  });

  const overallMetrics = metrics.summarizeEvaluations(perQuery.map(result => result.metrics));
  const byClass = {};
  for (const queryClass of [...new Set(queries.map(query => query.class))].sort()) {
    const classResults = perQuery.filter(result => result.class === queryClass);
    byClass[queryClass] = {
      ...metrics.summarizeEvaluations(classResults.map(result => result.metrics)),
      unjudged_at_10: classResults.reduce((sum, result) => sum + result.unjudged_at_10, 0)
        / classResults.length,
    };
  }
  const allTimings = perQuery.flatMap(result => result.timings_ms);
  return {
    deterministic_repeat_check: perQuery.every(result => result.deterministic),
    overall: {
      ...overallMetrics,
      unjudged_at_10: perQuery.reduce((sum, result) => sum + result.unjudged_at_10, 0)
        / perQuery.length,
    },
    by_class: byClass,
    first_measured_query: {
      query_id: firstRun[0]?.query_id ?? null,
      duration_ms: firstRun[0]?.duration_ms ?? null,
    },
    warm_query_latency_ms: {
      p50: roundMilliseconds(percentile(allTimings, 0.5)),
      p95: roundMilliseconds(percentile(allTimings, 0.95)),
    },
    queries: perQuery,
  };
}

async function benchmarkMode({
  mode,
  hybridSearch,
  entityDocuments,
  resources,
  identityDeclarations,
  queries,
  qrels,
  warmups,
  repetitions,
  cachePath,
  OramaSearchService,
  BacklogMemoryStore,
  metrics,
}) {
  const rssSamples = [];
  const serviceBuildStart = process.hrtime.bigint();
  recordRss(rssSamples, 'before_index');
  const searchService = new OramaSearchService({ cachePath, hybridSearch });
  // Production wiring: exact-ID navigation derives its prefix vocabulary
  // from the active registry's identity declarations (ADR 0121 R9).
  searchService.configureIdIntent(identityDeclarations);
  const adapter = new BenchmarkServiceAdapter(searchService);
  const memoryStore = new BacklogMemoryStore(() => adapter);
  const indexStart = process.hrtime.bigint();
  await searchService.index(entityDocuments);
  await searchService.reconcileResources(resources);
  const indexDuration = roundMilliseconds(durationMilliseconds(indexStart));
  searchService.flush();
  recordRss(rssSamples, 'after_index');

  const hybridActive = searchService.isHybridSearchActive();
  if (hybridSearch && !hybridActive) {
    fail('MiniLM hybrid initialization failed; refusing to record a BM25 fallback as a hybrid baseline');
  }

  const firstQuery = queries[0];
  if (firstQuery === undefined) fail('At least one query is required');
  const firstResultStart = process.hrtime.bigint();
  await retrieve(firstQuery, adapter, memoryStore);
  const firstResultAfterReady = roundMilliseconds(durationMilliseconds(firstResultStart));
  const serviceBuildToFirstResult = roundMilliseconds(
    durationMilliseconds(serviceBuildStart),
  );

  for (let index = 0; index < warmups; index += 1) {
    await runQuerySet(queries, adapter, memoryStore);
  }
  recordRss(rssSamples, 'after_warmups');

  const measuredRuns = [];
  for (let index = 0; index < repetitions; index += 1) {
    measuredRuns.push(await runQuerySet(queries, adapter, memoryStore));
    recordRss(rssSamples, `after_repetition_${index + 1}`);
  }
  searchService.flush();
  recordRss(rssSamples, 'after_flush');

  return {
    mode,
    hybrid_active: hybridActive,
    build_duration_ms: indexDuration,
    startup_ms: {
      service_build_to_first_result: serviceBuildToFirstResult,
      first_result_after_ready: firstResultAfterReady,
      probe_query_id: firstQuery.id,
    },
    cache_bytes: fileBytes(cachePath),
    rss: {
      before_bytes: rssSamples[0]?.bytes ?? process.memoryUsage().rss,
      after_bytes: rssSamples.at(-1)?.bytes ?? process.memoryUsage().rss,
      peak_sampled_bytes: Math.max(...rssSamples.map(sample => sample.bytes)),
      samples: rssSamples,
    },
    ...summarizeMode(queries, measuredRuns, groupJudgments(qrels), metrics),
  };
}

function writeReportAtomically(outputPath, report) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

async function loadRuntime(repoRoot) {
  const requireFromServer = createRequire(join(repoRoot, 'packages/server/package.json'));
  const paths = {
    orama: join(repoRoot, 'packages/server/dist/memory/src/search/orama-search-service.mjs'),
    memoryStore: join(repoRoot, 'packages/server/dist/memory/backlog-memory-store.mjs'),
    backlogHome: join(repoRoot, 'packages/server/dist/core/backlog-home.mjs'),
    homeRegistry: join(repoRoot, 'packages/server/dist/storage/local/home-substrate-registry.mjs'),
    storageCatalog: join(repoRoot, 'packages/server/dist/storage/local/builtin-substrate-storage-catalog.mjs'),
    storage: join(repoRoot, 'packages/server/dist/storage/local/docs-native-filesystem-storage.mjs'),
    searchDocument: join(repoRoot, 'packages/server/dist/core/substrates/create-search-entity-document.mjs'),
    resourceManager: join(repoRoot, 'packages/server/dist/resources/manager.mjs'),
    // Per-home recall (ADR 0121 R8) reuses the exact CLI runtime/coordinator
    // path — packages/server/src/cli/commands/recall.ts calls createCliRuntime
    // (cli/runner.ts) then the core recall() — instead of the synthetic
    // single-corpus reindex loadProductCorpus builds for search benchmarking.
    cliRunner: join(repoRoot, 'packages/server/dist/cli/runner.mjs'),
    coreRecall: join(repoRoot, 'packages/server/dist/core/recall.mjs'),
    coreConfig: join(repoRoot, 'packages/server/dist/core/config.mjs'),
    metrics: join(repoRoot, 'packages/memory/src/search/evaluation.ts'),
    transformers: requireFromServer.resolve('@huggingface/transformers'),
  };
  for (const [name, path] of Object.entries(paths)) {
    if (!existsSync(path)) {
      fail(`Missing ${name} runtime at ${path}; run "pnpm build" first`);
    }
  }
  const [
    oramaModule,
    memoryModule,
    backlogHomeModule,
    homeRegistryModule,
    storageCatalogModule,
    storageModule,
    searchDocumentModule,
    resourceManagerModule,
    cliRunnerModule,
    coreRecallModule,
    coreConfigModule,
    metrics,
    transformersModule,
  ] = await Promise.all([
    import(pathToFileURL(paths.orama).href),
    import(pathToFileURL(paths.memoryStore).href),
    import(pathToFileURL(paths.backlogHome).href),
    import(pathToFileURL(paths.homeRegistry).href),
    import(pathToFileURL(paths.storageCatalog).href),
    import(pathToFileURL(paths.storage).href),
    import(pathToFileURL(paths.searchDocument).href),
    import(pathToFileURL(paths.resourceManager).href),
    import(pathToFileURL(paths.cliRunner).href),
    import(pathToFileURL(paths.coreRecall).href),
    import(pathToFileURL(paths.coreConfig).href),
    import(pathToFileURL(paths.metrics).href),
    import(pathToFileURL(paths.transformers).href),
  ]);
  return {
    OramaSearchService: oramaModule.OramaSearchService,
    BacklogMemoryStore: memoryModule.BacklogMemoryStore,
    resolveBacklogHome: backlogHomeModule.resolveBacklogHome,
    loadHomeSubstrateRegistry: homeRegistryModule.loadHomeSubstrateRegistry,
    BuiltinSubstrateStorageCatalog: storageCatalogModule.BuiltinSubstrateStorageCatalog,
    DocsNativeFilesystemStorage: storageModule.DocsNativeFilesystemStorage,
    createSearchEntityDocument: searchDocumentModule.createSearchEntityDocument,
    ResourceManager: resourceManagerModule.ResourceManager,
    createCliRuntime: cliRunnerModule.createCliRuntime,
    recallCore: coreRecallModule.recall,
    resolveContext: coreConfigModule.resolveContext,
    metrics,
    transformersCacheDir:
      transformersModule.env?.cacheDir
      ?? transformersModule.default?.env?.cacheDir,
  };
}

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
    fail(`Project substrate diagnostics prevent a baseline: ${JSON.stringify(definitions.diagnostics)}`);
  }
  const storage = new runtime.DocsNativeFilesystemStorage(home, definitions.registry);
  const storedDocuments = Array.from(storage.iterateDocuments());
  const getSearchFields = definitions.registry.getSearchFields.bind(definitions.registry);
  const entityDocuments = storedDocuments.flatMap(function projectStoredEntity(stored) {
    const document = runtime.createSearchEntityDocument(stored.entity, getSearchFields);
    return document === undefined ? [] : [document];
  });
  const entitySourcePaths = new Set(storedDocuments.map(function sourcePath(stored) {
    return stored.sourcePath;
  }));
  const outputPath = canonicalPath(args.output);
  const resourceManager = new runtime.ResourceManager(home.documentsDir);
  const resources = resourceManager.list().filter(function excludeDerivedInputs(resource) {
    const absolutePath = canonicalPath(resolve(home.documentsDir, resource.path));
    return !entitySourcePaths.has(resource.path) && absolutePath !== outputPath;
  });
  const ids = new Set();
  const documentIds = [
    ...entityDocuments.map(function entityId(document) {
      return document.entity.id;
    }),
    ...resources.map(function resourceId(resource) {
      return resource.id;
    }),
  ];
  for (const id of documentIds) {
    if (ids.has(id)) fail(`Duplicate corpus document ID: ${id}`);
    ids.add(id);
  }
  if (ids.size === 0) fail(`Project corpus is empty: ${home.documentsDir}`);
  return { home, registry: definitions.registry, entityDocuments, resources, ids };
}

function writeTextAtomically(outputPath, content) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' });
    renameSync(temporaryPath, outputPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** Every memory-substrate id currently live in one resolved home. */
async function homeMemoryIds(cliRuntime) {
  const memories = await cliRuntime.service.list({ type: 'memory' });
  return new Set(memories.map(function memoryId(memory) {
    return memory.id;
  }));
}

/**
 * Run one recall query through the exact CLI path — core recall() over the
 * resolved home's memoryComposer — mirroring
 * packages/server/src/cli/commands/recall.ts's single-home branch down to
 * resolving the same optional context scope, short of its CLI-only concerns
 * (formatting, agent-provenance annotation, usage-demand logging; see
 * RECALL_PER_HOME_DECLARED_LIMITS).
 */
async function retrievePerHomeRecall(query, cliRuntime, runtime) {
  const context = runtime.resolveContext({
    explicit: query.options?.context,
    home: cliRuntime.home,
  });
  const params = {
    query: query.query,
    limit: query.options?.limit ?? 10,
    ...(query.options?.layers === undefined ? {} : { layers: query.options.layers }),
    ...(query.options?.tags === undefined ? {} : { tags: query.options.tags }),
    ...(context === undefined ? {} : { context }),
  };
  const result = await runtime.recallCore(params, { memoryComposer: cliRuntime.memoryComposer });
  return result.items.map(function itemId(item) {
    return item.id;
  });
}

/** Score one query's ranked ids at k = its own requested limit (default 10). */
function scoreHomeRecallQuery(query, rankedIds, judgmentsByQuery, metrics) {
  const k = query.options?.limit ?? 10;
  const judgments = judgmentsByQuery.get(query.id) ?? [];
  return {
    query_id: query.id,
    class: query.class,
    home: query.options.home,
    query: query.query,
    k,
    ranked_ids: rankedIds,
    metrics: {
      ndcg_at_k: metrics.ndcgAt(rankedIds, judgments, k),
      precision_at_k: metrics.precisionAt(rankedIds, judgments, k),
      recall_at_k: metrics.recallAt(rankedIds, judgments, k),
      unjudged_at_k: metrics.unjudgedRateAt(rankedIds, judgments, k),
    },
  };
}

function averageMetric(entries, key) {
  if (entries.length === 0) return 0;
  return entries.reduce((sum, entry) => sum + entry.metrics[key], 0) / entries.length;
}

/** Macro-average per-home recall scores so every query carries equal weight. */
function summarizeHomeRecall(entries) {
  return {
    query_count: entries.length,
    ndcg_at_k: averageMetric(entries, 'ndcg_at_k'),
    precision_at_k: averageMetric(entries, 'precision_at_k'),
    recall_at_k: averageMetric(entries, 'recall_at_k'),
    unjudged_at_k: averageMetric(entries, 'unjudged_at_k'),
  };
}

function formatScore(value) {
  return value.toFixed(4);
}

function renderRecallSummary(report) {
  const lines = [];
  lines.push('# Per-Home Recall Baseline — Run Summary');
  lines.push('');
  const homeCounts = Object.entries(report.by_home)
    .map(([home, summary]) => `${home}: ${summary.query_count}`)
    .join(', ');
  lines.push(`Queries: ${report.overall.query_count} (${homeCounts}) — `
    + `qrels: ${report.inputs.qrels.count} — commit \`${report.provenance.git_commit.slice(0, 12)}\`.`);
  lines.push('');
  lines.push('## Declared limits');
  lines.push('');
  for (const limit of report.declared_limits) {
    lines.push(`- ${limit}`);
  }
  lines.push('');
  lines.push('## Homes');
  lines.push('');
  lines.push('| home | memory_count | hybrid_active | root |');
  lines.push('|---|---|---|---|');
  for (const [home, info] of Object.entries(report.inputs.homes)) {
    lines.push(`| ${home} | ${info.memory_count} | ${info.hybrid_active} | ${info.root} |`);
  }
  lines.push('');
  lines.push('## Per-query scores');
  lines.push('');
  lines.push('| query_id | home | k | nDCG@k | precision@k | recall@k | unjudged@k |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const result of report.queries) {
    lines.push(`| ${result.query_id} | ${result.home} | ${result.k} `
      + `| ${formatScore(result.metrics.ndcg_at_k)} `
      + `| ${formatScore(result.metrics.precision_at_k)} `
      + `| ${formatScore(result.metrics.recall_at_k)} `
      + `| ${formatScore(result.metrics.unjudged_at_k)} |`);
  }
  lines.push('');
  lines.push('## By home');
  lines.push('');
  lines.push('| home | queries | nDCG@k | precision@k | recall@k | unjudged@k |');
  lines.push('|---|---|---|---|---|---|');
  for (const [home, summary] of Object.entries(report.by_home)) {
    lines.push(`| ${home} | ${summary.query_count} `
      + `| ${formatScore(summary.ndcg_at_k)} `
      + `| ${formatScore(summary.precision_at_k)} `
      + `| ${formatScore(summary.recall_at_k)} `
      + `| ${formatScore(summary.unjudged_at_k)} |`);
  }
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push(`queries: ${report.overall.query_count}, `
    + `nDCG@k ${formatScore(report.overall.ndcg_at_k)}, `
    + `precision@k ${formatScore(report.overall.precision_at_k)}, `
    + `recall@k ${formatScore(report.overall.recall_at_k)}, `
    + `unjudged@k ${formatScore(report.overall.unjudged_at_k)}.`);
  lines.push('');
  lines.push(report.provenance.gate_eligibility.eligible
    ? 'Gate eligibility: eligible — every judgment carries at least a human assessor of record.'
    : `Gate eligibility: NOT eligible — ${report.provenance.gate_eligibility.reason ?? ''}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Declared limitations (ADR 0121 R8), always embedded in the recall-per-home
 * report so a reader never mistakes it for scripts/structural-suite.mjs's
 * byte-stable, judge-free artifact.
 */
const RECALL_PER_HOME_DECLARED_LIMITS = [
  'This mode reuses the real CLI recall runtime — createCliRuntime '
    + '(packages/server/src/cli/runner.ts) -> createLocalRuntime -> the core '
    + 'recall() — the same path packages/server/src/cli/commands/recall.ts uses '
    + 'for `backlog recall --home <home>`, not the synthetic single-project '
    + 'reindex the search/hybrid benchmark in this same script builds. Scores '
    + 'measure the live production configuration (30-day half-life decay, real '
    + 'usage-multiplier reordering, real home content), not a frozen '
    + 'deterministic fixture.',
  'Because it queries live homes, two runs are not guaranteed byte-identical: '
    + 'elapsed days change temporal decay, and any change to a home\'s memory '
    + 'corpus or usage history changes ranking. This report is a dated baseline '
    + 'snapshot (see provenance.git_commit), not a byte-stable regenerable '
    + 'artifact like scripts/structural-suite.mjs.',
  'The runner never calls MemoryUsageTracker.recordRecall for scored queries, '
    + 'so it does not append to memory-usage.jsonl or retrieval-telemetry.jsonl '
    + '— repeated benchmark runs must not pollute the production usage/demand '
    + 'signals that drive consolidation and the usage multiplier. A real '
    + '`backlog recall` invocation does append them; this is the one '
    + 'deliberate divergence from full CLI parity.',
  'nDCG@k, precision@k, and recall@k all use k = the query\'s own '
    + 'options.limit (default 10), the same limit the recall call actually '
    + 'used — not a fixed benchmark cutoff.',
  'precision@k divides by the fixed cutoff k, not by the number of results '
    + 'actually returned, so a home whose real corpus holds fewer than k '
    + 'eligible memories is not artificially rewarded '
    + '(packages/memory/src/search/evaluation.ts precisionAt).',
  'A qrel document absent from the ranked results is scored as a miss (zero '
    + 'contribution to nDCG and recall), never rejected — '
    + 'docs/evaluation/R8-JUDGING-2026-07-18.md Q4 records exactly this case '
    + '(MEMO-0006).',
  'Assessor tiers follow docs/evaluation/JUDGING.md; '
    + 'provenance.gate_eligibility reflects whether every judgment carries at '
    + 'least a human assessor of record.',
];

/**
 * Score recall-queries-v2-style fixtures: each query names its own home
 * (ADR 0121 R8), so this builds one real CLI runtime per distinct home
 * (createCliRuntime — the same construction
 * packages/server/src/cli/commands/recall.ts uses), scores every query's
 * ranked ids against its qrels with the shared metrics module, and writes a
 * structural-suite-shaped report plus a Markdown summary.
 */
async function runPerHomeRecallReport(args, runtime, queries, queryInput, qrelInput, repoRoot) {
  const neededHomes = [...new Set(queries.map(query => query.options.home))].sort();
  // Declared and populated before the try so a failure partway through
  // resolving homes (e.g. the second home's hybrid search fails to init)
  // still closes whatever runtimes already opened — never a leaked watcher.
  const homeRuntimes = new Map();
  try {
    for (const home of neededHomes) {
      const cliRuntime = await runtime.createCliRuntime(
        home === 'project'
          ? { home: 'project', projectRoot: args.projectRoot }
          : { home: 'global' },
      );
      homeRuntimes.set(home, cliRuntime);
    }

    const queryHome = new Map(queries.map(query => [query.id, query.options.home]));
    const homeDocumentIds = new Map();
    for (const [home, cliRuntime] of homeRuntimes) {
      homeDocumentIds.set(home, await homeMemoryIds(cliRuntime));
    }
    for (const [home, ids] of homeDocumentIds) {
      if (ids.size === 0) fail(`Baseline v2+ requires a real memory corpus; the "${home}" home has none`);
    }

    const qrels = validateQrels(
      qrelInput.records,
      new Set(queries.map(query => query.id)),
      (documentId, queryId) => homeDocumentIds.get(queryHome.get(queryId))?.has(documentId) === true,
    );
    const judgmentsByQuery = groupJudgments(qrels);

    const results = [];
    for (const query of queries) {
      const cliRuntime = homeRuntimes.get(query.options.home);
      if (cliRuntime === undefined) fail(`No runtime resolved for home "${query.options.home}"`);
      const rankedIds = await retrievePerHomeRecall(query, cliRuntime, runtime);
      results.push(scoreHomeRecallQuery(query, rankedIds, judgmentsByQuery, runtime.metrics));
    }

    // isHybridSearchActive() only flips true once a real search has actually
    // run the embedding pipeline at least once — a warm on-disk cache
    // defers that to the first query instead of index-build time (unlike
    // the fresh-cache benchmark below). Checking only after every query
    // ran still refuses to record a silent BM25 fallback as recall
    // evidence, just without the benchmark's premature false positive.
    for (const [home, cliRuntime] of homeRuntimes) {
      if (cliRuntime.service.isHybridSearchActive?.() === false) {
        fail(`MiniLM hybrid initialization failed for the "${home}" home; refusing to record a BM25 fallback as recall evidence`);
      }
    }

    const byHome = {};
    for (const home of [...homeRuntimes.keys()].sort()) {
      byHome[home] = summarizeHomeRecall(results.filter(result => result.home === home));
    }

    const report = {
      schema_version: 1,
      runner: 'scripts/search-eval.mjs',
      mode: 'recall-per-home',
      baseline_version: args.baselineVersion,
      ruling: 'ADR 0121 R8 human recall judging session (Goga, assessor of record); JUDGING.md "memory-recall" class scores the real per-home recall path (docs/evaluation/R8-JUDGING-2026-07-18.md).',
      declared_limits: RECALL_PER_HOME_DECLARED_LIMITS,
      inputs: {
        queries: { path: args.queries, sha256: sha256(queryInput.raw), count: queries.length },
        qrels: { path: args.qrels, sha256: sha256(qrelInput.raw), count: qrels.length },
        homes: Object.fromEntries([...homeRuntimes.entries()].sort(
          function compareHomeEntries(left, right) {
            return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
          },
        ).map(function homeInput([home, cliRuntime]) {
          return [home, {
            home_id: cliRuntime.home.id,
            root: cliRuntime.home.root,
            documents_dir: cliRuntime.home.documentsDir,
            memory_count: homeDocumentIds.get(home).size,
            hybrid_active: cliRuntime.service.isHybridSearchActive?.() ?? false,
          }];
        })),
      },
      provenance: {
        git_commit: gitCommit(repoRoot),
        runner_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
        query_assessors: [...new Set(queries.map(query => query.assessor))].sort(),
        qrel_assessors: [...new Set(qrels.map(qrel => qrel.assessor))].sort(),
        judgment_tiers: { queries: countTiers(queries), qrels: countTiers(qrels) },
        gate_eligibility: gateEligibility(queries, qrels),
        query_sources: Object.fromEntries(queries.map(function querySource(query) {
          return [query.id, query.provenance];
        })),
      },
      queries: results,
      by_home: byHome,
      overall: summarizeHomeRecall(results),
    };

    writeReportAtomically(args.output, report);
    writeTextAtomically(args.summary, renderRecallSummary(report));
    process.stdout.write(`Recorded per-home recall baseline: ${args.output}\n`);
    process.stdout.write(`Summary: ${args.summary}\n`);
  } finally {
    const closeResults = await Promise.allSettled(
      [...homeRuntimes.values()].map(cliRuntime => cliRuntime.close()),
    );
    for (const result of closeResults) {
      if (result.status === 'rejected') {
        process.stderr.write(`search:eval: runtime close failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}\n`);
      }
    }
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = await loadRuntime(repoRoot);
  assertModelMetadata(repoRoot);
  const queryInput = readJsonLines(args.queries, 'queries');
  const qrelInput = readJsonLines(args.qrels, 'qrels');
  const queries = validateQueries(queryInput.records);
  const recallQueries = queries.filter(query => query.surface === 'recall');
  const homeRecallQueries = recallQueries.filter(query => query.options?.home !== undefined);

  if (homeRecallQueries.length > 0) {
    if (homeRecallQueries.length !== queries.length) {
      fail('Per-home recall runs require every query to be a "recall" query with options.home set; mixed search/home-recall runs are not supported in one invocation');
    }
    if (args.baselineVersion < 2) {
      fail('Per-home recall evidence requires --baseline-version 2 or later');
    }
    if (recallQueries.length < 4) {
      fail('Baseline v2+ requires at least four reviewed memory-recall queries');
    }
    if (args.summary === undefined) {
      fail('Missing required option: --summary (per-home recall reports emit a human-readable summary)');
    }
    await runPerHomeRecallReport(args, runtime, queries, queryInput, qrelInput, repoRoot);
    return;
  }

  if (typeof runtime.transformersCacheDir !== 'string') {
    fail('Cannot resolve the active Transformers.js filesystem cache');
  }
  const corpus = loadProductCorpus(args, runtime);
  const corpusInput = corpusSnapshot(corpus.entityDocuments, corpus.resources);
  if (args.baselineVersion === 1 && recallQueries.length > 0) {
    fail('Baseline v1 is search-only; real-memory recall evidence begins in v2');
  }
  if (args.baselineVersion >= 2) {
    if (recallQueries.length < 4) {
      fail('Baseline v2+ requires at least four reviewed memory-recall queries');
    }
    if ((countEntityTypes(corpus.entityDocuments).memory ?? 0) === 0) {
      fail('Baseline v2+ requires a real memory corpus; synthetic memories are not evidence');
    }
  }
  const qrels = validateQrels(
    qrelInput.records,
    new Set(queries.map(query => query.id)),
    documentId => corpus.ids.has(documentId),
  );

  const benchmarkDirectory = join(
    tmpdir(),
    `backlog-mcp-search-eval-${process.pid}-${Date.now()}`,
  );
  mkdirSync(benchmarkDirectory, { recursive: true });
  try {
    const modelCacheBefore = modelCacheSnapshot(runtime.transformersCacheDir);
    const common = {
      entityDocuments: corpus.entityDocuments,
      resources: corpus.resources,
      identityDeclarations: corpus.registry.listSubstrates().map(
        substrate => substrate.storageClaim.identity,
      ),
      queries,
      qrels,
      warmups: args.warmups,
      repetitions: args.repetitions,
      OramaSearchService: runtime.OramaSearchService,
      BacklogMemoryStore: runtime.BacklogMemoryStore,
      metrics: runtime.metrics,
    };
    const bm25 = await benchmarkMode({
      ...common,
      mode: 'bm25',
      hybridSearch: false,
      cachePath: join(benchmarkDirectory, 'bm25-index.json'),
    });
    const hybrid = await benchmarkMode({
      ...common,
      mode: 'hybrid',
      hybridSearch: true,
      cachePath: join(benchmarkDirectory, 'hybrid-index.json'),
    });
    const modelCacheAfter = modelCacheSnapshot(runtime.transformersCacheDir);
    if (!modelCacheAfter.complete) {
      fail('Hybrid search initialized without a complete MiniLM cache snapshot');
    }
    // Transformers.js 3.8.1 enforces these cached runtime values. The model
    // authors' separately reported 256-token trained window remains metadata.
    assertRuntimeTokenBoundary(modelCacheAfter.path);
    const modelDownloadedBytes = Math.max(
      0,
      modelCacheAfter.bytes - modelCacheBefore.bytes,
    );
    const modelSource = modelCacheBefore.complete
      && modelCacheAfter.bytes === modelCacheBefore.bytes
      ? 'cache'
      : 'downloaded';
    const report = {
      schema_version: 1,
      baseline_version: args.baselineVersion,
      generated_at: new Date().toISOString(),
      runner: 'scripts/search-eval.mjs',
      inputs: {
        corpus: {
          project_root: corpus.home.root,
          documents_dir: corpus.home.documentsDir,
          home_id: corpus.home.id,
          sha256: sha256(corpusInput),
          count: corpus.ids.size,
          entity_count: corpus.entityDocuments.length,
          resource_count: corpus.resources.length,
          excluded_output_path: canonicalPath(args.output),
          entity_types: countEntityTypes(corpus.entityDocuments),
        },
        queries: { path: args.queries, sha256: sha256(queryInput.raw), count: queries.length },
        qrels: { path: args.qrels, sha256: sha256(qrelInput.raw), count: qrels.length },
      },
      scope: {
        surfaces: [...new Set(queries.map(query => query.surface))].sort(),
        recall_classes: [...new Set(queries.filter(
          query => query.surface === 'recall',
        ).map(query => query.class))].sort(),
        ...(queries.some(query => query.surface === 'recall')
          ? {}
          : {
              recall_limitation: 'Absent — blocked pending a real memory corpus after global Phase E migration into ~/.backlog/docs; this report is not recall evidence.',
            }),
      },
      settings: {
        warmups: args.warmups,
        repetitions: args.repetitions,
        query_warmups_skipped: args.warmups === 0,
      },
      environment: buildEnvironment(repoRoot),
      provenance: {
        git_commit: gitCommit(repoRoot),
        runner_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
        corpus_membership_ruling: 'Beryl domain ruling, 2026-07-16: record after ADR 0113 Phase C so packaged substrate documents are members of the measured corpus.',
        query_assessors: [...new Set(queries.map(query => query.assessor))].sort(),
        qrel_assessors: [...new Set(qrels.map(qrel => qrel.assessor))].sort(),
        judgment_tiers: {
          queries: countTiers(queries),
          qrels: countTiers(qrels),
        },
        gate_eligibility: gateEligibility(queries, qrels),
        query_sources: Object.fromEntries(queries.map(function querySource(query) {
          return [query.id, query.provenance];
        })),
      },
      model: {
        ...MODEL_METADATA,
        model_source: modelSource,
        cache_path: modelCacheAfter.path,
        cache_complete_before: modelCacheBefore.complete,
        cache_complete_after: modelCacheAfter.complete,
        cache_bytes_before: modelCacheBefore.bytes,
        cache_bytes_after: modelCacheAfter.bytes,
        required_file_sha256: modelCacheAfter.required_file_sha256,
        ...(modelSource === 'downloaded'
          ? { downloaded_bytes: modelDownloadedBytes }
          : {}),
      },
      readiness_ms: {
        lexical_ready: bm25.build_duration_ms,
        semantic_ready: hybrid.build_duration_ms,
      },
      modes: { bm25, hybrid },
    };
    writeReportAtomically(args.output, report);
    process.stdout.write(`Recorded search baseline: ${args.output}\n`);
  } finally {
    rmSync(benchmarkDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`search:eval: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
