import { reportConfigIssue } from './config.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { paths } from '../../utils/paths.js';
import {
  createBacklogHome as constructHome,
  discoverProjectRoot as discoverRoot,
  resolveBacklogHome as resolveCallerHome,
  resolveWorkspaceHome as resolveWorkspace,
} from '../../core/backlog-home.js';
import type {
  BacklogHome,
  BacklogHomeDeps,
  CreateBacklogHomeParams,
  ResolveBacklogHomeParams,
} from '../../core/backlog-home.types.js';
import type { LocalHomeResolutionParams, LocalProjectRootParams } from './backlog-home.types.js';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const filesystem: BacklogHomeDeps = {
  exists: existsSync, read, reportConfigIssue,
  canonicalize: paths.canonicalizeThroughExistingAncestor.bind(paths),
  isDirectory, homeDir: homedir,
};

function dependencies(overrides?: Partial<BacklogHomeDeps>): BacklogHomeDeps {
  return overrides === undefined ? filesystem : { ...filesystem, ...overrides };
}

function callerParams(params: LocalHomeResolutionParams): ResolveBacklogHomeParams {
  const { deps: _deps, ...caller } = params;
  const userHome = (params.deps?.homeDir ?? homedir)();
  const cwd = paths.resolveUserPath(params.cwd?.trim() || process.cwd(), process.cwd(), userHome);
  function userPath(value: string | undefined): string | undefined {
    // Preserve blank explicit roots for the domain's actionable validation.
    return value === undefined || value.trim() === ''
      ? value
      : paths.resolveUserPath(value.trim(), cwd, userHome);
  }
  const env = params.env ?? process.env;
  const envProjectRoot = userPath(env.BACKLOG_PROJECT_ROOT);
  return {
    ...caller, cwd,
    projectRoot: userPath(params.projectRoot),
    globalRoot: userPath(params.globalRoot),
    stopDir: userPath(params.stopDir),
    env: envProjectRoot === undefined ? env : { ...env, BACKLOG_PROJECT_ROOT: envProjectRoot },
  };
}

/** Construct a canonical local home using the shared filesystem implementation. */
export function createBacklogHome(
  params: CreateBacklogHomeParams,
  overrides?: Partial<BacklogHomeDeps>,
): BacklogHome {
  return constructHome({
    ...params,
    root: paths.resolveUserPath(params.root, process.cwd(), (overrides?.homeDir ?? homedir)()),
  }, dependencies(overrides));
}

/** Discover a local project boundary through the domain's bounded walk. */
export function discoverProjectRoot(params: LocalProjectRootParams): string | undefined {
  const userHome = (params.deps?.homeDir ?? homedir)();
  return discoverRoot({
    startDir: paths.resolveUserPath(params.startDir, process.cwd(), userHome),
    stopDir: params.stopDir === undefined
      ? undefined : paths.resolveUserPath(params.stopDir, process.cwd(), userHome),
  }, dependencies(params.deps));
}

/** Resolve caller defaults for existing CLI, bridge and server workflows. */
export function resolveBacklogHome(params: LocalHomeResolutionParams = {}): BacklogHome {
  return resolveCallerHome(callerParams(params), dependencies(params.deps));
}

/** Resolve a workspace-local home with the same filesystem and home constructor. */
export function resolveWorkspaceHome(params: LocalHomeResolutionParams = {}): BacklogHome {
  return resolveWorkspace(callerParams(params), dependencies(params.deps));
}
