import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  extname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { parseEntityId } from '@backlog-mcp/shared';
import { discoverDocuments } from './document-discovery.js';
import { parseDocumentIdentity } from './document-identity.js';
import { claimSubstrateDocuments } from './substrates/index.js';
import { isPathWithin } from './backlog-home.js';
import { storageDocumentSourcePath } from '../storage/storage-identity.js';
import type {
  DocsNativeMigrationAction,
  AssertDocsNativeMigrationCompleteOptions,
  DocsNativeMigrationConfig,
  DocsNativeMigrationConfigSource,
  DocsNativeMigrationDirectoryEntry,
  DocsNativeMigrationFileSystem,
  DocsNativeMigrationIssue,
  DocsNativeMigrationMove,
  DocsNativeMigrationPlan,
  DocsNativeMigrationReport,
  MigrateDocsNativeParams,
  PlanDocsNativeMigrationParams,
} from './migrate-docs-native.types.js';

const realFileSystem: DocsNativeMigrationFileSystem = {
  exists: existsSync,
  isSymbolicLink: function isSymbolicLink(path) {
    return lstatSync(path).isSymbolicLink();
  },
  realpath: realpathSync,
  readDirectory: function readDirectory(path) {
    return readdirSync(path, { withFileTypes: true });
  },
  readFile: readFileSync,
  makeDirectory: function makeDirectory(path) {
    mkdirSync(path, { recursive: true });
  },
  writeFileExclusive: function writeFileExclusive(path, content) {
    writeFileSync(path, content, { flag: 'wx' });
  },
  writeFile: writeFileSync,
  unlink: unlinkSync,
  removeTree: function removeTree(path) {
    rmSync(path, { recursive: true, force: true });
  },
  removeEmptyDirectory: function removeEmptyDirectory(path) {
    try {
      rmdirSync(path);
    } catch {
      // Existing or concurrently-created siblings keep their directory.
    }
  },
};

interface CollectedLegacyFile {
  sourcePath: string;
  absolutePath: string;
}

interface PlannedEntityDocument {
  sourcePath: string;
  type: string;
  id: string;
  targetDocumentPath: string;
  content: string;
  sourceDigest: string;
  targetContent?: Buffer;
}

const LEGACY_PROJECT_CONTROL_DIR = '.backlog-mcp';

/** Error containing every deterministic preflight issue. */
export class DocsNativeMigrationError extends Error {
  constructor(readonly issues: readonly DocsNativeMigrationIssue[]) {
    super(issues.map(function formatIssue(issue) {
      return issue.message;
    }).join('\n'));
    this.name = 'DocsNativeMigrationError';
  }
}

/** Error raised instead of serving a deceptively empty docs-native home. */
export class DocsNativeMigrationRequiredError extends Error {
  constructor(readonly homeKind: 'global' | 'project', command: string) {
    super(`Docs-native migration required; stop the server and run: ${command}`);
    this.name = 'DocsNativeMigrationRequiredError';
  }
}

function fileSystem(
  overrides: Partial<DocsNativeMigrationFileSystem> | undefined,
): DocsNativeMigrationFileSystem {
  return { ...realFileSystem, ...overrides };
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function digest(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function normalizeLegacyValue(value: unknown): {
  value: unknown;
  changed: boolean;
} {
  if (value instanceof Date) {
    return { value: value.toISOString(), changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const normalized = value.map(function normalizeArrayValue(item) {
      const result = normalizeLegacyValue(item);
      changed ||= result.changed;
      return result.value;
    });
    return { value: normalized, changed };
  }
  if (typeof value === 'object' && value !== null) {
    let changed = false;
    const normalized = Object.fromEntries(
      Object.entries(value).map(function normalizeObjectEntry([key, item]) {
        const result = normalizeLegacyValue(item);
        changed ||= result.changed;
        return [key, result.value];
      }),
    );
    return { value: normalized, changed };
  }
  return { value, changed: false };
}

function normalizeLegacyEntityData(
  data: Record<string, unknown>,
): {
  data: Record<string, unknown>;
  changed: boolean;
  parentConflict: boolean;
} {
  const normalized = normalizeLegacyValue(data);
  const value = normalized.value as Record<string, unknown>;
  let changed = normalized.changed;
  const epicId = value.epic_id;
  const parentId = value.parent_id;

  if (
    typeof epicId === 'string'
    && typeof parentId === 'string'
    && epicId !== parentId
  ) {
    return { data: value, changed: false, parentConflict: true };
  }
  if (typeof epicId === 'string') {
    if (parentId === undefined) value.parent_id = epicId;
    delete value.epic_id;
    changed = true;
  }

  return { data: value, changed, parentConflict: false };
}

function configHasLegacyScope(
  path: string,
  fs: DocsNativeMigrationFileSystem,
): boolean {
  if (!fs.exists(path)) return false;
  try {
    const value = JSON.parse(fs.readFile(path).toString('utf-8')) as unknown;
    return typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
      && 'scope' in value;
  } catch {
    return false;
  }
}

/**
 * Fail closed while a home still has data the docs-native runtime would ignore.
 *
 * The explicit migration command is the only upgrade path; runtime startup
 * never guesses, merges, or silently dual-reads legacy locations.
 */
export function assertDocsNativeMigrationComplete(
  home: PlanDocsNativeMigrationParams['home'],
  options: AssertDocsNativeMigrationCompleteOptions = {},
): void {
  const fs = fileSystem(options.fileSystem);
  if (home.kind === 'project') {
    const legacyControl = join(home.root, LEGACY_PROJECT_CONTROL_DIR);
    const configNeedsRename = [
      join(home.controlDir, 'config.json'),
      join(home.controlDir, 'config.local.json'),
    ].some(function hasLegacyContextName(path) {
      return configHasLegacyScope(path, fs);
    });
    if (!fs.exists(legacyControl) && !configNeedsRename) return;
    throw new DocsNativeMigrationRequiredError(
      'project',
      `backlog migrate docs-native --home project --project-root "${home.root}"`,
    );
  }

  const legacyPaths = [
    'tasks',
    'resources',
    'identity.md',
    '.internal',
    'memory-usage.jsonl',
    'logs',
    '.cache',
    LEGACY_PROJECT_CONTROL_DIR,
    'config.local.json',
  ];
  const roots = [
    home.root,
    ...(options.legacyRoot === undefined
      ? []
      : [resolve(options.legacyRoot)]),
  ].filter(function uniqueRoot(root, index, candidates) {
    return candidates.indexOf(root) === index;
  });
  const hasLegacyPath = roots.some(function rootHasLegacyPath(root) {
    return legacyPaths.some(function legacyPathExists(path) {
      return fs.exists(join(root, path));
    });
  });
  const configNeedsRename = roots.some(function rootConfigNeedsRename(root) {
    return configHasLegacyScope(join(root, 'config.json'), fs);
  });
  if (!hasLegacyPath && !configNeedsRename) return;
  throw new DocsNativeMigrationRequiredError(
    'global',
    'backlog migrate docs-native --home global',
  );
}

function rootRelativePath(root: string, path: string): string {
  const result = toPosix(relative(root, path));
  if (result === '') return '';
  if (
    result === '..'
    || result.startsWith('../')
    || posix.isAbsolute(result)
  ) {
    throw new Error(`Migration path must be inside its root: ${path}`);
  }
  return result;
}

function compareActions(
  left: DocsNativeMigrationAction,
  right: DocsNativeMigrationAction,
): number {
  const leftPath = left.kind === 'move'
    ? `${left.targetPath}\u0000${left.sourcePath}`
    : left.kind === 'config'
      ? `${left.targetPath}\u0000config`
      : `${left.root}\u0000${left.path}`;
  const rightPath = right.kind === 'move'
    ? `${right.targetPath}\u0000${right.sourcePath}`
    : right.kind === 'config'
      ? `${right.targetPath}\u0000config`
      : `${right.root}\u0000${right.path}`;
  return leftPath.localeCompare(rightPath);
}

function compareIssues(
  left: DocsNativeMigrationIssue,
  right: DocsNativeMigrationIssue,
): number {
  const codeOrder = left.code.localeCompare(right.code);
  if (codeOrder !== 0) return codeOrder;
  const leftPath = left.targetPath ?? left.sourcePaths[0] ?? '';
  const rightPath = right.targetPath ?? right.sourcePaths[0] ?? '';
  return leftPath.localeCompare(rightPath);
}

function collectFiles(
  root: string,
  sourceRoot: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
): CollectedLegacyFile[] {
  if (!fs.exists(sourceRoot)) return [];
  try {
    if (fs.isSymbolicLink(sourceRoot)) {
      const sourcePath = rootRelativePath(root, sourceRoot) || '.';
      issues.push({
        code: 'unsupported-source',
        message: `Legacy migration does not follow symbolic-link roots: ${sourcePath}`,
        sourcePaths: [sourcePath],
      });
      return [];
    }
  } catch (error) {
    const sourcePath = rootRelativePath(root, sourceRoot) || '.';
    issues.push({
      code: 'unsupported-source',
      message: `Cannot inspect legacy migration root ${sourcePath}: ${String(error)}`,
      sourcePaths: [sourcePath],
    });
    return [];
  }

  const files: CollectedLegacyFile[] = [];
  function visit(directory: string): void {
    let entries: DocsNativeMigrationDirectoryEntry[];
    try {
      entries = fs.readDirectory(directory);
    } catch (error) {
      issues.push({
        code: 'unsupported-source',
        message: `Cannot read legacy migration directory ${rootRelativePath(root, directory)}: ${String(error)}`,
        sourcePaths: [rootRelativePath(root, directory)],
      });
      return;
    }

    entries.sort(function compareNames(left, right) {
      return left.name.localeCompare(right.name);
    });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const sourcePath = rootRelativePath(root, absolutePath);
      if (entry.isSymbolicLink()) {
        issues.push({
          code: 'unsupported-source',
          message: `Legacy migration does not follow symbolic links: ${sourcePath}`,
          sourcePaths: [sourcePath],
        });
      } else if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push({ sourcePath, absolutePath });
      } else {
        issues.push({
          code: 'unsupported-source',
          message: `Unsupported legacy migration source: ${sourcePath}`,
          sourcePaths: [sourcePath],
        });
      }
    }
  }

  visit(sourceRoot);
  return files.sort(function compareSourcePaths(left, right) {
    return left.sourcePath.localeCompare(right.sourcePath);
  });
}

function createMove(
  category: DocsNativeMigrationMove['category'],
  sourcePath: string,
  targetPath: string,
  entity?: {
    id: string;
    type: string;
    rewritten?: boolean;
    quarantined?: boolean;
  },
): DocsNativeMigrationMove {
  return {
    kind: 'move',
    category,
    sourcePath,
    targetPath,
    ...(entity === undefined
      ? {}
      : {
          entityId: entity.id,
          substrateType: entity.type,
          ...(entity.rewritten ? { rewritten: true } : {}),
          ...(entity.quarantined ? { quarantined: true } : {}),
        }),
  };
}

function legacyTaskResourceMove(
  file: CollectedLegacyFile,
  tasksRoot: string,
  documentsRootPath: string,
): DocsNativeMigrationMove {
  const relativeTaskPath = toPosix(relative(tasksRoot, file.absolutePath));
  return {
    ...createMove(
      'resource',
      file.sourcePath,
      posix.join(
        documentsRootPath,
        'resources',
        'legacy-tasks',
        relativeTaskPath,
      ),
    ),
    quarantined: true,
  };
}

function inferredEntityIdentity(
  file: CollectedLegacyFile,
): { id: string; type: string } | undefined {
  const id = basename(file.sourcePath, extname(file.sourcePath));
  const parsed = parseEntityId(id);
  return parsed === null ? undefined : { id, type: parsed.type };
}

function planQuarantinedEntity(
  file: CollectedLegacyFile,
  identity: { id: string; type: string },
  raw: Buffer,
  params: PlanDocsNativeMigrationParams,
  documentsRootPath: string,
): {
  move: DocsNativeMigrationMove;
  document: PlannedEntityDocument;
} | undefined {
  const claim = params.registry.getStorageClaim(identity.type);
  if (claim === undefined) return undefined;
  const targetDocumentPath = storageDocumentSourcePath(claim, identity.id);
  return {
    move: createMove(
      'entity',
      file.sourcePath,
      posix.join(documentsRootPath, targetDocumentPath),
      { ...identity, quarantined: true },
    ),
    document: {
      sourcePath: file.sourcePath,
      type: identity.type,
      id: identity.id,
      targetDocumentPath,
      content: raw.toString('utf-8'),
      sourceDigest: digest(raw),
    },
  };
}

function planEntity(
  file: CollectedLegacyFile,
  params: PlanDocsNativeMigrationParams,
  fs: DocsNativeMigrationFileSystem,
  documentsRootPath: string,
  issues: DocsNativeMigrationIssue[],
): {
  move?: DocsNativeMigrationMove;
  document?: PlannedEntityDocument;
} {
  const tasksRoot = join(resolve(params.legacyRoot ?? params.home.root), 'tasks');
  if (!/\.md$/iu.test(file.sourcePath)) {
    return { move: legacyTaskResourceMove(file, tasksRoot, documentsRootPath) };
  }

  let raw: Buffer;
  try {
    raw = fs.readFile(file.absolutePath);
  } catch (error) {
    issues.push({
      code: 'invalid-entity',
      message: `Cannot read legacy entity ${file.sourcePath}: ${String(error)}`,
      sourcePaths: [file.sourcePath],
    });
    return {};
  }

  try {
    const markdown = matter(raw.toString('utf-8'), {});
    const normalized = normalizeLegacyEntityData(
      markdown.data as Record<string, unknown>,
    );
    const data = normalized.data;
    const targetContent = normalized.changed
      ? Buffer.from(matter.stringify(markdown.content, data))
      : raw;
    const filenameId = basename(file.sourcePath, extname(file.sourcePath));
    const id = typeof data.id === 'string' && data.id.trim()
      ? data.id.trim()
      : filenameId;
    if (id !== filenameId) {
      issues.push({
        code: 'invalid-entity',
        message: `Legacy entity id ${id} does not match filename ${filenameId}: ${file.sourcePath}`,
        sourcePaths: [file.sourcePath],
      });
      return {};
    }
    const inferredType = parseEntityId(id)?.type ?? 'task';
    const type = typeof data.type === 'string' && data.type.trim()
      ? data.type.trim()
      : inferredType;
    const candidate = {
      ...data,
      id,
      type,
      content: markdown.content.trim(),
    };
    const validation = params.registry.validateWrite(candidate);
    const shouldRewrite = validation.ok
      && normalized.changed
      && !normalized.parentConflict;
    const plannedContent = shouldRewrite ? targetContent : raw;
    const claim = params.registry.getStorageClaim(type);
    if (claim === undefined) {
      return {
        move: legacyTaskResourceMove(file, tasksRoot, documentsRootPath),
      };
    }
    const targetDocumentPath = storageDocumentSourcePath(claim, id);
    const targetPath = posix.join(documentsRootPath, targetDocumentPath);
    return {
      move: createMove('entity', file.sourcePath, targetPath, {
        id,
        type,
        rewritten: shouldRewrite,
        quarantined: !validation.ok,
      }),
      document: {
        sourcePath: file.sourcePath,
        type,
        id,
        targetDocumentPath,
        content: plannedContent.toString('utf-8'),
        sourceDigest: digest(raw),
        ...(shouldRewrite ? { targetContent } : {}),
      },
    };
  } catch {
    const identity = inferredEntityIdentity(file);
    if (identity !== undefined) {
      const quarantined = planQuarantinedEntity(
        file,
        identity,
        raw,
        params,
        documentsRootPath,
      );
      if (quarantined !== undefined) return quarantined;
    }
    return { move: legacyTaskResourceMove(file, tasksRoot, documentsRootPath) };
  }
}

function addOptionalFile(
  actions: DocsNativeMigrationAction[],
  legacyRoot: string,
  fs: DocsNativeMigrationFileSystem,
  sourcePath: string,
  targetPath: string,
  category: DocsNativeMigrationMove['category'],
): void {
  if (fs.exists(join(legacyRoot, ...sourcePath.split('/')))) {
    actions.push(createMove(category, sourcePath, targetPath));
  }
}

function addTreeMoves(
  actions: DocsNativeMigrationAction[],
  issues: DocsNativeMigrationIssue[],
  legacyRoot: string,
  sourceRootPath: string,
  targetRootPath: string,
  category: DocsNativeMigrationMove['category'],
  fs: DocsNativeMigrationFileSystem,
): void {
  const sourceRoot = join(legacyRoot, ...sourceRootPath.split('/'));
  for (const file of collectFiles(legacyRoot, sourceRoot, fs, issues)) {
    const nestedPath = toPosix(relative(sourceRoot, file.absolutePath));
    actions.push(createMove(
      category,
      file.sourcePath,
      posix.join(targetRootPath, nestedPath),
    ));
  }
}

function addProjectControlMoves(
  params: PlanDocsNativeMigrationParams,
  legacyRoot: string,
  controlRootPath: string,
  actions: DocsNativeMigrationAction[],
  issues: DocsNativeMigrationIssue[],
  fs: DocsNativeMigrationFileSystem,
): boolean {
  const targetControl = params.home.controlDir;
  if (fs.exists(legacyRoot) && fs.exists(targetControl)) {
    issues.push({
      code: 'ambiguous-control-layout',
      message: `Both project control directories exist; resolve them manually before migration: ${legacyRoot}, ${targetControl}`,
      sourcePaths: [
        rootRelativePath(params.home.root, legacyRoot),
        rootRelativePath(params.home.root, targetControl),
      ].sort(),
    });
    return false;
  }
  if (!fs.exists(legacyRoot)) return true;

  for (const file of collectFiles(legacyRoot, legacyRoot, fs, issues)) {
    if (
      file.sourcePath === 'config.json'
      || file.sourcePath === 'config.local.json'
    ) {
      continue;
    }
    if (file.sourcePath === '.gitignore') {
      actions.push(createMove(
        'config',
        file.sourcePath,
        posix.join(controlRootPath, file.sourcePath),
      ));
    } else if (file.sourcePath.startsWith('state/')) {
      actions.push(createMove(
        'legacy-state',
        file.sourcePath,
        posix.join(controlRootPath, file.sourcePath),
      ));
    } else if (!file.sourcePath.startsWith('cache/')) {
      issues.push({
        code: 'unsupported-source',
        message: `Project control migration only moves .gitignore, cache/, state/, config.json, and config.local.json; resolve ${posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath)} manually`,
        sourcePaths: [posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath)],
      });
    }
  }

  const legacyCache = join(legacyRoot, 'cache');
  if (fs.exists(legacyCache)) {
    actions.push({
      kind: 'discard',
      category: 'cache',
      root: 'legacy',
      path: 'cache',
    });
  }
  return true;
}

function addNestedGlobalControlMoves(
  legacyRoot: string,
  controlRootPath: string,
  actions: DocsNativeMigrationAction[],
  issues: DocsNativeMigrationIssue[],
  fs: DocsNativeMigrationFileSystem,
): void {
  const nestedControl = join(legacyRoot, LEGACY_PROJECT_CONTROL_DIR);
  if (!fs.exists(nestedControl)) return;

  for (const file of collectFiles(nestedControl, nestedControl, fs, issues)) {
    if (
      file.sourcePath === 'config.json'
      || file.sourcePath === 'config.local.json'
    ) {
      continue;
    }
    if (file.sourcePath.startsWith('state/')) {
      actions.push(createMove(
        'legacy-state',
        posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath),
        posix.join(controlRootPath, file.sourcePath),
      ));
    } else if (!file.sourcePath.startsWith('cache/')) {
      issues.push({
        code: 'unsupported-source',
        message: `Nested global control migration only moves cache/, state/, and config files: ${posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath)}`,
        sourcePaths: [posix.join(LEGACY_PROJECT_CONTROL_DIR, file.sourcePath)],
      });
    }
  }

  if (fs.exists(join(nestedControl, 'cache'))) {
    actions.push({
      kind: 'discard',
      category: 'cache',
      root: 'legacy',
      path: posix.join(LEGACY_PROJECT_CONTROL_DIR, 'cache'),
    });
  }
}

function configSourceAbsolute(
  source: DocsNativeMigrationConfigSource,
  legacyRoot: string,
  homeRoot: string,
): string {
  const root = source.root === 'legacy' ? legacyRoot : homeRoot;
  return join(root, ...source.path.split('/'));
}

function normalizedConfig(
  source: DocsNativeMigrationConfigSource,
  legacyRoot: string,
  homeRoot: string,
  fs: DocsNativeMigrationFileSystem,
  issues?: DocsNativeMigrationIssue[],
): Record<string, unknown> | undefined {
  const absolutePath = configSourceAbsolute(source, legacyRoot, homeRoot);
  try {
    const value = JSON.parse(fs.readFile(absolutePath).toString('utf-8')) as unknown;
    if (
      typeof value !== 'object'
      || value === null
      || Array.isArray(value)
    ) {
      throw new Error('config must be a JSON object');
    }
    const config = { ...value } as Record<string, unknown>;
    if ('scope' in config && 'context' in config) {
      throw new Error('config declares both scope and context');
    }
    if ('scope' in config) {
      config.context = config.scope;
      delete config.scope;
    }
    return config;
  } catch (error) {
    issues?.push({
      code: 'invalid-config',
      message: `Cannot migrate config ${source.path}: ${String(error)}`,
      sourcePaths: [source.path],
    });
    return undefined;
  }
}

function addConfigAction(
  action: DocsNativeMigrationConfig,
  legacyRoot: string,
  homeRoot: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
  actions: DocsNativeMigrationAction[],
): void {
  const parsed = action.sources.map(function parseSource(source) {
    return normalizedConfig(source, legacyRoot, homeRoot, fs, issues);
  });
  if (parsed.some(function isInvalid(value) {
    return value === undefined;
  })) {
    return;
  }
  if (action.sources.length === 1) {
    const source = action.sources[0];
    if (source !== undefined) {
      const sourcePath = configSourceAbsolute(source, legacyRoot, homeRoot);
      const targetPath = join(homeRoot, ...action.targetPath.split('/'));
      if (sourcePath === targetPath) {
        const raw = JSON.parse(fs.readFile(sourcePath).toString('utf-8')) as
          Record<string, unknown>;
        if (!('scope' in raw)) return;
      }
    }
  }
  actions.push(action);
}

function addProjectConfigActions(
  homeRoot: string,
  legacyRoot: string,
  controlRootPath: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
  actions: DocsNativeMigrationAction[],
): void {
  const useLegacy = fs.exists(legacyRoot);
  const sourceRoot = useLegacy
    ? legacyRoot
    : join(homeRoot, ...controlRootPath.split('/'));
  const sourceKind = useLegacy ? 'legacy' : 'home';
  const sourcePrefix = useLegacy ? '' : controlRootPath;

  for (const name of ['config.json', 'config.local.json']) {
    if (!fs.exists(join(sourceRoot, name))) continue;
    addConfigAction({
      kind: 'config',
      category: 'config',
      sources: [{
        root: sourceKind,
        path: sourcePrefix === '' ? name : posix.join(sourcePrefix, name),
      }],
      targetPath: posix.join(controlRootPath, name),
    }, legacyRoot, homeRoot, fs, issues, actions);
  }
}

function addGlobalConfigAction(
  homeRoot: string,
  legacyRoot: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
  actions: DocsNativeMigrationAction[],
): void {
  const nestedPrefix = LEGACY_PROJECT_CONTROL_DIR;
  const nestedConfig = fs.exists(join(legacyRoot, nestedPrefix, 'config.json'));
  const nestedLocal = fs.exists(
    join(legacyRoot, nestedPrefix, 'config.local.json'),
  );
  const rootConfig = fs.exists(join(legacyRoot, 'config.json'));
  const rootLocal = fs.exists(join(legacyRoot, 'config.local.json'));

  if ((nestedConfig || nestedLocal) && (rootConfig || rootLocal)) {
    issues.push({
      code: 'ambiguous-control-layout',
      message: `Global config exists in both the home root and ${LEGACY_PROJECT_CONTROL_DIR}; resolve the two layouts manually`,
      sourcePaths: [
        ...(rootConfig ? ['config.json'] : []),
        ...(rootLocal ? ['config.local.json'] : []),
        ...(nestedConfig ? [`${nestedPrefix}/config.json`] : []),
        ...(nestedLocal ? [`${nestedPrefix}/config.local.json`] : []),
      ].sort(),
    });
    return;
  }

  const sources: DocsNativeMigrationConfigSource[] = [];
  if (nestedConfig) {
    sources.push({ root: 'legacy', path: `${nestedPrefix}/config.json` });
  }
  if (nestedLocal) {
    sources.push({ root: 'legacy', path: `${nestedPrefix}/config.local.json` });
  }
  if (rootConfig) sources.push({ root: 'legacy', path: 'config.json' });
  if (rootLocal) {
    sources.push({ root: 'legacy', path: 'config.local.json' });
  }
  if (sources.length === 0) return;

  addConfigAction({
    kind: 'config',
    category: 'config',
    sources,
    targetPath: 'config.json',
  }, legacyRoot, homeRoot, fs, issues, actions);
}

function addCollisionIssues(
  params: PlanDocsNativeMigrationParams,
  plannedDocuments: readonly PlannedEntityDocument[],
  issues: DocsNativeMigrationIssue[],
): void {
  const discovered = discoverDocuments({
    documentsDir: params.home.documentsDir,
  });
  const syntheticDocuments = plannedDocuments.map(function createDocument(document) {
    return {
      sourcePath: document.targetDocumentPath,
      absolutePath: join(
        params.home.documentsDir,
        ...document.targetDocumentPath.split('/'),
      ),
      format: 'markdown' as const,
      content: document.content,
      identity: parseDocumentIdentity({
        sourcePath: document.targetDocumentPath,
      }),
    };
  });
  const claims = claimSubstrateDocuments({
    homeKey: params.home.root,
    documents: [...discovered.documents, ...syntheticDocuments],
    substrates: params.registry.listSubstrates(),
  });

  for (const diagnostic of claims.diagnostics) {
    issues.push({
      code: 'identity-collision',
      message: `Docs-native ${diagnostic.type} identity ${diagnostic.semanticKey} collides across ${diagnostic.sourcePaths.join(', ')}`,
      sourcePaths: diagnostic.sourcePaths,
    });
  }
}

function canonicalizeMigrationPath(
  path: string,
  fs: DocsNativeMigrationFileSystem,
): string {
  const missingSegments: string[] = [];
  let existingPath = resolve(path);
  while (!fs.exists(existingPath)) {
    const parent = dirname(existingPath);
    if (parent === existingPath) return resolve(path);
    missingSegments.unshift(basename(existingPath));
    existingPath = parent;
  }
  return resolve(fs.realpath(existingPath), ...missingSegments);
}

function addDestinationContainmentIssue(
  homeRoot: string,
  targetPath: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
): void {
  try {
    const canonicalRoot = canonicalizeMigrationPath(homeRoot, fs);
    const target = join(homeRoot, ...targetPath.split('/'));
    const canonicalTarget = canonicalizeMigrationPath(target, fs);
    if (isPathWithin(canonicalRoot, canonicalTarget)) return;
    issues.push({
      code: 'unsupported-source',
      message: `Docs-native migration destination escapes its home through a symbolic link: ${targetPath}`,
      sourcePaths: [],
      targetPath,
    });
  } catch (error) {
    issues.push({
      code: 'unsupported-source',
      message: `Cannot validate docs-native migration destination ${targetPath}: ${String(error)}`,
      sourcePaths: [],
      targetPath,
    });
  }
}

function addDestinationIssues(
  planRoot: string,
  legacyRoot: string,
  actions: readonly DocsNativeMigrationAction[],
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
): void {
  const byTarget = new Map<string, DocsNativeMigrationMove[]>();
  for (const action of actions) {
    if (action.kind !== 'move') continue;
    const group = byTarget.get(action.targetPath) ?? [];
    group.push(action);
    byTarget.set(action.targetPath, group);
  }

  for (const [targetPath, group] of byTarget) {
    const sourcePaths = group.map(function getSourcePath(action) {
      return action.sourcePath;
    }).sort();
    if (group.length > 1) {
      issues.push({
        code: 'identity-collision',
        message: `Several legacy sources resolve to ${targetPath}: ${sourcePaths.join(', ')}`,
        sourcePaths,
        targetPath,
      });
    }
    addDestinationContainmentIssue(planRoot, targetPath, fs, issues);
    if (fs.exists(join(planRoot, ...targetPath.split('/')))) {
      issues.push({
        code: 'destination-exists',
        message: `Docs-native migration destination already exists: ${targetPath}`,
        sourcePaths,
        targetPath,
      });
    }
  }

  for (const action of actions) {
    if (action.kind !== 'config') continue;
    const moveSources = byTarget.get(action.targetPath)?.map(
      function getMoveSource(move) {
        return move.sourcePath;
      },
    ) ?? [];
    if (moveSources.length > 0) {
      issues.push({
        code: 'identity-collision',
        message: `Config migration and legacy moves both resolve to ${action.targetPath}`,
        sourcePaths: [
          ...moveSources,
          ...action.sources.map(function getConfigSource(source) {
            return source.path;
          }),
        ].sort(),
        targetPath: action.targetPath,
      });
    }

    const target = join(planRoot, ...action.targetPath.split('/'));
    addDestinationContainmentIssue(
      planRoot,
      action.targetPath,
      fs,
      issues,
    );
    const targetIsSource = action.sources.some(function matchesTarget(source) {
      return configSourceAbsolute(source, legacyRoot, planRoot) === target;
    });
    if (fs.exists(target) && !targetIsSource) {
      issues.push({
        code: 'destination-exists',
        message: `Docs-native migration destination already exists: ${action.targetPath}`,
        sourcePaths: action.sources.map(function getSource(source) {
          return source.path;
        }).sort(),
        targetPath: action.targetPath,
      });
    }
  }
}

function captureMoveDigests(
  actions: readonly DocsNativeMigrationAction[],
  legacyRoot: string,
  fs: DocsNativeMigrationFileSystem,
  issues: DocsNativeMigrationIssue[],
  sourceDigests: Map<string, string>,
): void {
  for (const action of actions) {
    if (action.kind !== 'move' || sourceDigests.has(action.sourcePath)) {
      continue;
    }
    try {
      const source = join(legacyRoot, ...action.sourcePath.split('/'));
      sourceDigests.set(action.sourcePath, digest(fs.readFile(source)));
    } catch (error) {
      issues.push({
        code: 'unsupported-source',
        message: `Cannot snapshot legacy migration source ${action.sourcePath}: ${String(error)}`,
        sourcePaths: [action.sourcePath],
      });
    }
  }
}

function sortedDigests(
  sourceDigests: ReadonlyMap<string, string>,
): Readonly<Record<string, string>> {
  return Object.fromEntries([...sourceDigests].sort(function comparePaths(
    left,
    right,
  ) {
    return left[0].localeCompare(right[0]);
  }));
}

function sortedTargetContents(
  targetContents: ReadonlyMap<string, Buffer>,
): Readonly<Record<string, Buffer>> {
  return Object.fromEntries([...targetContents].sort(function comparePaths(
    left,
    right,
  ) {
    return left[0].localeCompare(right[0]);
  }));
}

/** Build the complete deterministic migration plan without mutating disk. */
export function planDocsNativeMigration(
  params: PlanDocsNativeMigrationParams,
): DocsNativeMigrationPlan {
  const fs = fileSystem(params.fileSystem);
  const legacyRoot = resolve(
    params.legacyRoot
      ?? (params.home.kind === 'project'
        ? join(params.home.root, LEGACY_PROJECT_CONTROL_DIR)
        : params.home.root),
  );
  const homeRoot = resolve(params.home.root);
  const issues: DocsNativeMigrationIssue[] = [];
  const actions: DocsNativeMigrationAction[] = [];
  const plannedDocuments: PlannedEntityDocument[] = [];
  const sourceDigests = new Map<string, string>();
  const targetContents = new Map<string, Buffer>();

  const documentsRootPath = rootRelativePath(homeRoot, params.home.documentsDir);
  const controlRootPath = rootRelativePath(homeRoot, params.home.controlDir);
  if (params.home.kind === 'project') {
    const unambiguous = addProjectControlMoves(
      params,
      legacyRoot,
      controlRootPath,
      actions,
      issues,
      fs,
    );
    if (unambiguous) {
      addProjectConfigActions(
        homeRoot,
        legacyRoot,
        controlRootPath,
        fs,
        issues,
        actions,
      );
    }
    captureMoveDigests(actions, legacyRoot, fs, issues, sourceDigests);
    addDestinationIssues(homeRoot, legacyRoot, actions, fs, issues);
    return {
      homeKind: params.home.kind,
      legacyRoot,
      homeRoot,
      actions: actions.sort(compareActions),
      issues: issues.sort(compareIssues),
      sourceDigests: sortedDigests(sourceDigests),
      targetContents: {},
    };
  }

  const tasksRoot = join(legacyRoot, 'tasks');
  for (const file of collectFiles(legacyRoot, tasksRoot, fs, issues)) {
    const planned = planEntity(
      file,
      { ...params, legacyRoot },
      fs,
      documentsRootPath,
      issues,
    );
    if (planned.move !== undefined) actions.push(planned.move);
    if (planned.document !== undefined) {
      plannedDocuments.push(planned.document);
      sourceDigests.set(
        planned.document.sourcePath,
        planned.document.sourceDigest,
      );
      if (planned.document.targetContent !== undefined) {
        targetContents.set(
          planned.document.sourcePath,
          planned.document.targetContent,
        );
      }
    }
  }

  addTreeMoves(
    actions,
    issues,
    legacyRoot,
    'resources',
    posix.join(documentsRootPath, 'resources'),
    'resource',
    fs,
  );
  addTreeMoves(
    actions,
    issues,
    legacyRoot,
    '.internal',
    posix.join(controlRootPath, 'state', 'legacy-internal'),
    'legacy-state',
    fs,
  );
  const legacyOperations = actions.find(function isLegacyOperations(action) {
    return action.kind === 'move'
      && action.sourcePath === '.internal/operations.jsonl';
  });
  if (legacyOperations?.kind === 'move') {
    const index = actions.indexOf(legacyOperations);
    actions[index] = createMove(
      'operations',
      legacyOperations.sourcePath,
      posix.join(controlRootPath, 'state', 'operations.jsonl'),
    );
  }
  addTreeMoves(
    actions,
    issues,
    legacyRoot,
    'logs',
    posix.join(controlRootPath, 'state', 'logs', 'legacy'),
    'log',
    fs,
  );
  addOptionalFile(
    actions,
    legacyRoot,
    fs,
    'identity.md',
    posix.join(documentsRootPath, 'identity.md'),
    'identity',
  );
  addOptionalFile(
    actions,
    legacyRoot,
    fs,
    'memory-usage.jsonl',
    posix.join(controlRootPath, 'state', 'memory-usage.jsonl'),
    'usage',
  );
  addNestedGlobalControlMoves(
    legacyRoot,
    controlRootPath,
    actions,
    issues,
    fs,
  );
  addGlobalConfigAction(
    homeRoot,
    legacyRoot,
    fs,
    issues,
    actions,
  );

  if (fs.exists(join(legacyRoot, '.cache'))) {
    actions.push({
      kind: 'discard',
      category: 'cache',
      root: 'legacy',
      path: '.cache',
    });
  }
  const homeCachePath = posix.join(controlRootPath, 'cache');
  const absoluteHomeCache = join(homeRoot, ...homeCachePath.split('/'));
  if (
    fs.exists(absoluteHomeCache)
    && !(legacyRoot === homeRoot && homeCachePath === '.cache')
  ) {
    actions.push({
      kind: 'discard',
      category: 'cache',
      root: 'home',
      path: homeCachePath,
    });
  }

  addCollisionIssues(params, plannedDocuments, issues);
  captureMoveDigests(actions, legacyRoot, fs, issues, sourceDigests);
  addDestinationIssues(homeRoot, legacyRoot, actions, fs, issues);

  return {
    homeKind: params.home.kind,
    legacyRoot,
    homeRoot,
    actions: actions.sort(compareActions),
    issues: issues.sort(compareIssues),
    sourceDigests: sortedDigests(sourceDigests),
    targetContents: sortedTargetContents(targetContents),
  };
}

function missingDirectories(
  path: string,
  stopAt: string,
  fs: DocsNativeMigrationFileSystem,
): string[] {
  const directories: string[] = [];
  let current = path;
  while (current !== stopAt && !fs.exists(current)) {
    directories.push(current);
    current = dirname(current);
  }
  return directories;
}

function cleanupCreatedTargets(
  targets: readonly string[],
  directories: readonly string[],
  fs: DocsNativeMigrationFileSystem,
): void {
  for (const target of [...targets].reverse()) {
    try {
      fs.unlink(target);
    } catch {
      // Best effort: the error that caused rollback remains primary.
    }
  }
  for (const directory of [...directories].sort(function deepestFirst(left, right) {
    return right.length - left.length;
  })) {
    fs.removeEmptyDirectory(directory);
  }
}

function renderConfig(
  action: DocsNativeMigrationConfig,
  plan: DocsNativeMigrationPlan,
  fs: DocsNativeMigrationFileSystem,
  sourceContents: ReadonlyMap<string, Buffer>,
): Buffer {
  const snapshotFileSystem: DocsNativeMigrationFileSystem = {
    ...fs,
    readFile: function readSnapshot(path) {
      const content = sourceContents.get(path);
      if (content === undefined) {
        throw new Error(`Config source was not snapshotted: ${path}`);
      }
      return content;
    },
  };
  let merged: Record<string, unknown> = {};
  for (const source of action.sources) {
    const config = normalizedConfig(
      source,
      plan.legacyRoot,
      plan.homeRoot,
      snapshotFileSystem,
    );
    if (config === undefined) {
      throw new Error(`Config changed before migration: ${source.path}`);
    }
    merged = { ...merged, ...config };
  }
  return Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
}

function assertSourceUnchanged(
  sourcePath: string,
  absolutePath: string,
  expectedDigest: string,
  fs: DocsNativeMigrationFileSystem,
): Buffer {
  const content = fs.readFile(absolutePath);
  if (digest(content) !== expectedDigest) {
    throw new Error(
      `Legacy migration source changed after planning: ${sourcePath}`,
    );
  }
  return content;
}

function assertDestinationContained(
  plan: DocsNativeMigrationPlan,
  targetPath: string,
  fs: DocsNativeMigrationFileSystem,
): void {
  const root = canonicalizeMigrationPath(plan.homeRoot, fs);
  const target = canonicalizeMigrationPath(
    join(plan.homeRoot, ...targetPath.split('/')),
    fs,
  );
  if (!isPathWithin(root, target)) {
    throw new Error(
      `Docs-native migration destination escapes its home: ${targetPath}`,
    );
  }
}

function restoreDeletedSources(
  deletedSources: ReadonlyMap<string, Buffer>,
  fs: DocsNativeMigrationFileSystem,
): void {
  for (const [source, content] of deletedSources) {
    try {
      fs.makeDirectory(dirname(source));
      fs.writeFileExclusive(source, content);
    } catch {
      // Best effort: the error that caused rollback remains primary.
    }
  }
}

function cleanupEmptySourceDirectories(
  sourcePaths: readonly string[],
  legacyRoot: string,
  includeLegacyRoot: boolean,
  fs: DocsNativeMigrationFileSystem,
): void {
  const directories = new Set<string>();
  for (const source of sourcePaths) {
    let current = dirname(source);
    while (current !== legacyRoot && isPathWithin(legacyRoot, current)) {
      directories.add(current);
      current = dirname(current);
    }
  }
  if (includeLegacyRoot) directories.add(legacyRoot);
  for (const directory of [...directories].sort(function deepestFirst(
    left,
    right,
  ) {
    return right.length - left.length;
  })) {
    fs.removeEmptyDirectory(directory);
  }
}

function cleanupEmptyLegacyTree(
  root: string,
  fs: DocsNativeMigrationFileSystem,
): void {
  if (!fs.exists(root) || fs.isSymbolicLink(root)) return;
  let entries: DocsNativeMigrationDirectoryEntry[];
  try {
    entries = fs.readDirectory(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      cleanupEmptyLegacyTree(join(root, entry.name), fs);
    }
  }
  fs.removeEmptyDirectory(root);
}

function executePlan(
  plan: DocsNativeMigrationPlan,
  fs: DocsNativeMigrationFileSystem,
): DocsNativeMigrationReport {
  if (plan.issues.length > 0) throw new DocsNativeMigrationError(plan.issues);
  const moves = plan.actions.filter(
    (action): action is DocsNativeMigrationMove => action.kind === 'move',
  );
  const configs = plan.actions.filter(
    (action): action is DocsNativeMigrationConfig => action.kind === 'config',
  );
  const sourceContents = new Map<string, Buffer>();
  const renderedConfigs = new Map<DocsNativeMigrationConfig, Buffer>();

  for (const move of moves) {
    const source = join(plan.legacyRoot, ...move.sourcePath.split('/'));
    const target = join(plan.homeRoot, ...move.targetPath.split('/'));
    if (!fs.exists(source)) {
      throw new Error(`Legacy migration source changed before execution: ${move.sourcePath}`);
    }
    if (fs.exists(target)) {
      throw new Error(`Docs-native migration destination changed before execution: ${move.targetPath}`);
    }
    const expectedDigest = plan.sourceDigests[move.sourcePath];
    if (expectedDigest === undefined) {
      throw new Error(`Legacy migration source was not snapshotted: ${move.sourcePath}`);
    }
    sourceContents.set(
      source,
      assertSourceUnchanged(
        move.sourcePath,
        source,
        expectedDigest,
        fs,
      ),
    );
    assertDestinationContained(plan, move.targetPath, fs);
  }
  for (const config of configs) {
    const target = join(plan.homeRoot, ...config.targetPath.split('/'));
    for (const source of config.sources) {
      if (!fs.exists(configSourceAbsolute(
        source,
        plan.legacyRoot,
        plan.homeRoot,
      ))) {
        throw new Error(`Config source changed before execution: ${source.path}`);
      }
      const absoluteSource = configSourceAbsolute(
        source,
        plan.legacyRoot,
        plan.homeRoot,
      );
      sourceContents.set(absoluteSource, fs.readFile(absoluteSource));
    }
    const targetIsSource = config.sources.some(function matchesTarget(source) {
      return configSourceAbsolute(
        source,
        plan.legacyRoot,
        plan.homeRoot,
      ) === target;
    });
    if (fs.exists(target) && !targetIsSource) {
      throw new Error(`Config destination changed before execution: ${config.targetPath}`);
    }
    assertDestinationContained(plan, config.targetPath, fs);
    renderedConfigs.set(
      config,
      renderConfig(config, plan, fs, sourceContents),
    );
  }

  const createdTargets: string[] = [];
  const createdDirectories = new Set<string>();
  const overwrittenTargets = new Map<string, Buffer>();
  const deletedSources = new Map<string, Buffer>();
  let movedConfigs = 0;
  try {
    for (const move of moves) {
      const source = join(plan.legacyRoot, ...move.sourcePath.split('/'));
      const target = join(plan.homeRoot, ...move.targetPath.split('/'));
      const parent = dirname(target);
      for (const directory of missingDirectories(parent, plan.homeRoot, fs)) {
        createdDirectories.add(directory);
      }
      fs.makeDirectory(parent);
      const content = sourceContents.get(source);
      if (content === undefined) {
        throw new Error(`Legacy migration source was not snapshotted: ${move.sourcePath}`);
      }
      fs.writeFileExclusive(
        target,
        plan.targetContents[move.sourcePath] ?? content,
      );
      createdTargets.push(target);
    }
    for (const config of configs) {
      const target = join(plan.homeRoot, ...config.targetPath.split('/'));
      const parent = dirname(target);
      for (const directory of missingDirectories(parent, plan.homeRoot, fs)) {
        createdDirectories.add(directory);
      }
      fs.makeDirectory(parent);
      const content = renderedConfigs.get(config);
      if (content === undefined) {
        throw new Error(`Config was not prepared before migration: ${config.targetPath}`);
      }
      if (fs.exists(target)) {
        overwrittenTargets.set(target, fs.readFile(target));
        fs.writeFile(target, content);
      } else {
        fs.writeFileExclusive(target, content);
        createdTargets.push(target);
      }
    }

    for (const move of moves) {
      const source = join(plan.legacyRoot, ...move.sourcePath.split('/'));
      const expectedDigest = plan.sourceDigests[move.sourcePath];
      const content = sourceContents.get(source);
      if (expectedDigest === undefined || content === undefined) {
        throw new Error(`Legacy migration source was not snapshotted: ${move.sourcePath}`);
      }
      assertSourceUnchanged(move.sourcePath, source, expectedDigest, fs);
      fs.unlink(source);
      deletedSources.set(source, content);
    }
    for (const config of configs) {
      const target = join(plan.homeRoot, ...config.targetPath.split('/'));
      for (const source of config.sources) {
        const absoluteSource = configSourceAbsolute(
          source,
          plan.legacyRoot,
          plan.homeRoot,
        );
        if (absoluteSource !== target) {
          const content = sourceContents.get(absoluteSource);
          if (content === undefined) {
            throw new Error(`Config source was not snapshotted: ${source.path}`);
          }
          if (digest(fs.readFile(absoluteSource)) !== digest(content)) {
            throw new Error(`Config source changed after planning: ${source.path}`);
          }
          fs.unlink(absoluteSource);
          deletedSources.set(absoluteSource, content);
          movedConfigs += 1;
        }
      }
    }
  } catch (error) {
    restoreDeletedSources(deletedSources, fs);
    for (const [target, content] of overwrittenTargets) {
      try {
        fs.writeFile(target, content);
      } catch {
        // Best effort: the error that caused rollback remains primary.
      }
    }
    cleanupCreatedTargets(
      createdTargets,
      [...createdDirectories],
      fs,
    );
    throw error;
  }

  const discards = plan.actions.filter(function isDiscard(action) {
    return action.kind === 'discard';
  });
  for (const discard of discards) {
    const root = discard.root === 'legacy' ? plan.legacyRoot : plan.homeRoot;
    fs.removeTree(join(root, ...discard.path.split('/')));
  }
  cleanupEmptySourceDirectories(
    [...deletedSources.keys()],
    plan.legacyRoot,
    plan.homeKind === 'project',
    fs,
  );
  if (plan.homeKind === 'project') {
    cleanupEmptyLegacyTree(plan.legacyRoot, fs);
  } else {
    for (const directory of [
      'tasks',
      'resources',
      '.internal',
      'logs',
      LEGACY_PROJECT_CONTROL_DIR,
    ]) {
      cleanupEmptyLegacyTree(join(plan.legacyRoot, directory), fs);
    }
  }

  return {
    dryRun: false,
    actions: plan.actions,
    moved: moves.length + movedConfigs,
    rewritten: configs.length + Object.keys(plan.targetContents).length,
    discarded: discards.length,
  };
}

/** Plan and optionally execute the one-shot global docs-native migration. */
export function migrateDocsNative(
  params: MigrateDocsNativeParams,
): DocsNativeMigrationReport {
  const plan = planDocsNativeMigration(params);
  if (plan.issues.length > 0) throw new DocsNativeMigrationError(plan.issues);
  if (params.dryRun) {
    return {
      dryRun: true,
      actions: plan.actions,
      moved: 0,
      rewritten: 0,
      discarded: 0,
    };
  }
  return executePlan(plan, fileSystem(params.fileSystem));
}
