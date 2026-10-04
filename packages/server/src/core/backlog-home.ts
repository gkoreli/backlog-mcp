import {
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import type {
  BacklogHome,
  BacklogHomeDeps,
  CreateBacklogHomeParams,
  DiscoverProjectRootParams,
  ResolveBacklogHomeParams,
} from './backlog-home.types.js';
import { loadRepoConfig, type RepoConfig } from './config.js';
import { BacklogHomeResolutionError, WorkspaceHomeResolutionError } from './backlog-home.errors.js';
import { parseHomeSelector, validateHomeSelection } from './backlog-home-selection.js';
import { isPathWithin } from './path-containment.js';

export { BacklogHomeResolutionError } from './backlog-home.errors.js';
export { isPathWithin } from './path-containment.js';

export const BACKLOG_HOME_ENV_VAR = 'BACKLOG_HOME';
export const BACKLOG_PROJECT_ROOT_ENV_VAR = 'BACKLOG_PROJECT_ROOT';
export const BACKLOG_HOME_HEADER = 'X-Backlog-Home';
export const BACKLOG_PROJECT_ROOT_HEADER = 'X-Backlog-Project-Root';
export const BACKLOG_CONTROL_DIR = '.backlog';
export const BACKLOG_DOCUMENTS_DIR = 'docs';
export const VCS_MARKER = '.git';

interface ProjectContext {
  projectRoot?: string;
  config: RepoConfig;
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
  const root = deps.canonicalize(
    clean(params.globalRoot) ?? join(deps.homeDir(), '.backlog'),
  );
  return createBacklogHome({
    kind: 'global',
    root,
    documentsDir: params.documentsDir,
    controlDir: root,
  }, deps);
}

function resolveProjectContext(
  params: ResolveBacklogHomeParams,
  deps: BacklogHomeDeps,
): ProjectContext {
  const startDir = deps.canonicalize(params.cwd);
  const selectedStopDir = clean(params.stopDir);
  const stopDir = selectedStopDir === undefined
    ? undefined
    : deps.canonicalize(selectedStopDir);
  const projectRoot = discoverProjectRoot({
    startDir,
    stopDir,
  }, deps);
  const config = loadRepoConfig(startDir, {
    exists: deps.exists,
    read: deps.read,
    reportIssue: deps.reportConfigIssue,
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
    reportIssue: deps.reportConfigIssue,
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
 * Construct a canonical home and reject documents/control paths outside it.
 */
export function createBacklogHome(
  params: CreateBacklogHomeParams,
  deps: BacklogHomeDeps,
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

  // Family awareness (LATTICE W1): a linked-worktree project root learns
  // its family through the injected probe. Fail-open — no probe, or a
  // failed one, and the home is exactly what it was before families existed.
  const family = params.kind === 'project'
    ? deps.resolveFamily?.(root)
    : undefined;

  return {
    kind: params.kind,
    id: params.kind === 'global' ? 'global' : root,
    root,
    documentsDir,
    controlDir,
    ...(family === undefined ? {} : { family }),
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
  deps: BacklogHomeDeps,
): string | undefined {
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
  params: ResolveBacklogHomeParams,
  deps: BacklogHomeDeps,
): BacklogHome {
  const explicitSelector = parseHomeSelector(params.home);
  const explicitProjectRoot = clean(params.projectRoot);
  const env = params.env;
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

  const envSelector = parseHomeSelector(env[BACKLOG_HOME_ENV_VAR]);

  if (envSelector === 'global') return createGlobalHome(params, deps);
  if (envSelector === 'project') {
    return requireProjectHome(params, envProjectRoot, deps);
  }
  if (envProjectRoot !== undefined) {
    return createSelectedProjectHome(envProjectRoot, params, deps);
  }

  const context = resolveProjectContext(params, deps);
  const configSelector = parseHomeSelector(context.config.home);
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

/**
 * Resolve a workspace-only home without consulting inherited home/root defaults.
 * Explicit global selection is supported; cross-home fan-out belongs to callers.
 */
export function resolveWorkspaceHome(
  params: ResolveBacklogHomeParams,
  deps: BacklogHomeDeps,
): BacklogHome {
  const selector = parseHomeSelector(params.home);
  if (selector === 'global') {
    validateHomeSelection(params);
    return createGlobalHome(params, deps);
  }
  if (params.projectRoot !== undefined && !params.projectRoot.trim()) {
    throw new WorkspaceHomeResolutionError('invalid-root');
  }
  const root = clean(params.projectRoot) ?? discoverProjectRoot({
    startDir: params.cwd,
    stopDir: params.stopDir,
  }, deps);
  if (root === undefined) {
    throw new WorkspaceHomeResolutionError('missing-boundary');
  }
  if (!deps.isDirectory(root)) {
    throw new WorkspaceHomeResolutionError('invalid-root', root);
  }
  return createSelectedProjectHome(root, params, deps);
}
