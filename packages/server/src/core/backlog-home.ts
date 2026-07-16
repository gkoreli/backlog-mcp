import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import type {
  BacklogHome,
  BacklogHomeDeps,
  BacklogHomeSelector,
  CreateBacklogHomeParams,
  DiscoverProjectRootParams,
  ResolveBacklogHomeParams,
} from './backlog-home.types.js';
import { loadRepoConfig, type RepoConfig } from './config.js';

export const BACKLOG_HOME_ENV_VAR = 'BACKLOG_HOME';
export const BACKLOG_PROJECT_ROOT_ENV_VAR = 'BACKLOG_PROJECT_ROOT';
export const BACKLOG_HOME_HEADER = 'X-Backlog-Home';
export const BACKLOG_PROJECT_ROOT_HEADER = 'X-Backlog-Project-Root';
export const BACKLOG_CONTROL_DIR = '.backlog-mcp';
export const BACKLOG_DOCUMENTS_DIR = 'docs';
export const VCS_MARKER = '.git';

const realDeps: BacklogHomeDeps = {
  exists: existsSync,
  read: (path) => readFileSync(path, 'utf-8'),
  canonicalize: canonicalizeRealPath,
  homeDir: homedir,
};

interface ProjectContext {
  projectRoot?: string;
  config: RepoConfig;
}

/** Error raised when an explicitly selected home cannot be resolved safely. */
export class BacklogHomeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BacklogHomeResolutionError';
  }
}

/**
 * Canonicalize a path through its nearest existing ancestor.
 *
 * The final documents or control directory may not exist yet, while an
 * existing symlinked ancestor still needs to resolve to its physical path.
 */
function canonicalizeRealPath(path: string): string {
  const absolutePath = resolve(path);
  const missingSegments: string[] = [];
  let existingPath = absolutePath;

  while (!existsSync(existingPath)) {
    const parent = dirname(existingPath);
    if (parent === existingPath) return absolutePath;
    missingSegments.unshift(basename(existingPath));
    existingPath = parent;
  }

  return resolve(realpathSync(existingPath), ...missingSegments);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveHomeChild(
  root: string,
  configuredPath: string | undefined,
  fallbackName: string,
  deps: BacklogHomeDeps,
): string {
  const selectedPath = clean(configuredPath) ?? fallbackName;
  const absolutePath = isAbsolute(selectedPath)
    ? selectedPath
    : join(root, selectedPath);
  const canonicalPath = deps.canonicalize(absolutePath);

  if (!isPathWithin(root, canonicalPath)) {
    throw new BacklogHomeResolutionError(
      `Backlog home path escapes its root: ${canonicalPath} is outside ${root}`,
    );
  }

  return canonicalPath;
}

function normalizeSelector(value: string | undefined): BacklogHomeSelector | undefined {
  const selector = clean(value);
  if (selector === undefined) return undefined;
  if (selector === 'global' || selector === 'project') return selector;
  throw new BacklogHomeResolutionError(
    `Invalid backlog home "${selector}"; expected "global" or "project"`,
  );
}

function walkUp(startDir: string, stopDir: string | undefined): string[] {
  if (stopDir !== undefined && !isPathWithin(stopDir, startDir)) return [];

  const directories: string[] = [];
  let currentDir = startDir;

  for (;;) {
    directories.push(currentDir);
    if (currentDir === stopDir) break;

    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  return directories;
}

function findProjectBoundary(
  directories: readonly string[],
  deps: BacklogHomeDeps,
): string | undefined {
  for (const directory of directories) {
    if (deps.exists(join(directory, BACKLOG_CONTROL_DIR))) return directory;
    if (deps.exists(join(directory, VCS_MARKER))) return directory;
  }
  return undefined;
}

function createProjectHome(
  projectRoot: string,
  params: ResolveBacklogHomeParams,
  deps: BacklogHomeDeps,
  documentsDir = params.documentsDir,
): BacklogHome {
  return createBacklogHome({
    kind: 'project',
    root: projectRoot,
    documentsDir,
    controlDir: params.controlDir,
  }, deps);
}

function createGlobalHome(
  params: ResolveBacklogHomeParams,
  deps: BacklogHomeDeps,
): BacklogHome {
  return createBacklogHome({
    kind: 'global',
    root: clean(params.globalRoot) ?? join(deps.homeDir(), '.backlog'),
    documentsDir: params.documentsDir,
    controlDir: params.controlDir,
  }, deps);
}

function resolveProjectContext(
  params: ResolveBacklogHomeParams,
  deps: BacklogHomeDeps,
): ProjectContext {
  const startDir = deps.canonicalize(clean(params.cwd) ?? process.cwd());
  const selectedStopDir = clean(params.stopDir);
  const stopDir = selectedStopDir === undefined
    ? undefined
    : deps.canonicalize(selectedStopDir);
  const projectRoot = discoverProjectRoot({
    startDir,
    stopDir,
    deps,
  });
  const config = loadRepoConfig(startDir, {
    exists: deps.exists,
    read: deps.read,
  }, stopDir);
  return { projectRoot, config };
}

function configuredDocumentsDir(
  params: ResolveBacklogHomeParams,
  config: RepoConfig,
): string | undefined {
  return clean(params.documentsDir) ?? clean(config.documentsDir);
}

function createSelectedProjectHome(
  projectRoot: string,
  params: ResolveBacklogHomeParams,
  deps: BacklogHomeDeps,
): BacklogHome {
  const canonicalRoot = deps.canonicalize(projectRoot);
  const config = loadRepoConfig(canonicalRoot, {
    exists: deps.exists,
    read: deps.read,
  }, canonicalRoot);
  return createProjectHome(
    canonicalRoot,
    params,
    deps,
    configuredDocumentsDir(params, config),
  );
}

function discoverDocumentsHome(
  params: ResolveBacklogHomeParams,
  deps: BacklogHomeDeps,
  context: ProjectContext,
): BacklogHome | undefined {
  if (context.projectRoot === undefined) return undefined;
  const home = createProjectHome(
    context.projectRoot,
    params,
    deps,
    configuredDocumentsDir(params, context.config),
  );
  return deps.exists(home.documentsDir) ? home : undefined;
}

function requireProjectHome(
  params: ResolveBacklogHomeParams,
  projectRoot: string | undefined,
  deps: BacklogHomeDeps,
): BacklogHome {
  if (projectRoot !== undefined) {
    return createSelectedProjectHome(projectRoot, params, deps);
  }

  const context = resolveProjectContext(params, deps);
  if (context.projectRoot !== undefined) {
    return createProjectHome(
      context.projectRoot,
      params,
      deps,
      configuredDocumentsDir(params, context.config),
    );
  }

  throw new BacklogHomeResolutionError(
    'Project home selected, but no project boundary was found',
  );
}

/**
 * Return whether `candidate` is the same path as `root` or a descendant of it.
 *
 * Callers should pass canonical absolute paths when symlink containment matters.
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === ''
    || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath)
    );
}

/**
 * Construct a canonical home and reject documents/control paths outside it.
 */
export function createBacklogHome(
  params: CreateBacklogHomeParams,
  deps: BacklogHomeDeps = realDeps,
): BacklogHome {
  const root = deps.canonicalize(params.root);
  const documentsDir = resolveHomeChild(
    root,
    params.documentsDir,
    BACKLOG_DOCUMENTS_DIR,
    deps,
  );
  const controlDir = resolveHomeChild(
    root,
    params.controlDir,
    BACKLOG_CONTROL_DIR,
    deps,
  );

  return {
    kind: params.kind,
    id: params.kind === 'global' ? 'global' : root,
    root,
    documentsDir,
    controlDir,
  };
}

/**
 * Find the nearest bounded project boundary. A config marker takes priority
 * over a VCS marker in the same directory, but discovery never crosses the
 * first VCS boundary to find configuration in an enclosing repository.
 *
 * `stopDir` is inclusive. Discovery returns no result when `startDir` is
 * outside the supplied boundary.
 */
export function discoverProjectRoot(
  params: DiscoverProjectRootParams,
): string | undefined {
  const deps = params.deps ?? realDeps;
  const startDir = deps.canonicalize(params.startDir);
  const selectedStopDir = clean(params.stopDir);
  const stopDir = selectedStopDir !== undefined
    ? deps.canonicalize(selectedStopDir)
    : undefined;
  const directories = walkUp(startDir, stopDir);

  return findProjectBoundary(directories, deps);
}

/**
 * Resolve one caller's active home using:
 * explicit selection/root, caller environment, repository config,
 * discovered project docs, then the user-global home.
 */
export function resolveBacklogHome(
  params: ResolveBacklogHomeParams = {},
): BacklogHome {
  const deps = params.deps ?? realDeps;
  const explicitSelector = normalizeSelector(params.home);
  const explicitProjectRoot = clean(params.projectRoot);
  const env = params.env ?? process.env;
  const envProjectRoot = clean(env[BACKLOG_PROJECT_ROOT_ENV_VAR]);

  if (explicitSelector === 'global') return createGlobalHome(params, deps);
  if (explicitSelector === 'project') {
    return requireProjectHome(
      params,
      explicitProjectRoot ?? envProjectRoot,
      deps,
    );
  }
  if (explicitProjectRoot !== undefined) {
    return createSelectedProjectHome(explicitProjectRoot, params, deps);
  }

  const envSelector = normalizeSelector(env[BACKLOG_HOME_ENV_VAR]);

  if (envSelector === 'global') return createGlobalHome(params, deps);
  if (envSelector === 'project') {
    return requireProjectHome(params, envProjectRoot, deps);
  }
  if (envProjectRoot !== undefined) {
    return createSelectedProjectHome(envProjectRoot, params, deps);
  }

  const context = resolveProjectContext(params, deps);
  const configSelector = normalizeSelector(context.config.home);
  if (configSelector === 'global') return createGlobalHome(params, deps);
  if (configSelector === 'project') {
    if (context.projectRoot === undefined) {
      throw new BacklogHomeResolutionError(
        'Repository config selected a project home without a project boundary',
      );
    }
    return createProjectHome(
      context.projectRoot,
      params,
      deps,
      configuredDocumentsDir(params, context.config),
    );
  }

  const configDocumentsDir = clean(context.config.documentsDir);
  if (context.projectRoot !== undefined && configDocumentsDir !== undefined) {
    return createProjectHome(
      context.projectRoot,
      params,
      deps,
      configuredDocumentsDir(params, context.config),
    );
  }

  return discoverDocumentsHome(params, deps, context)
    ?? createGlobalHome(params, deps);
}
