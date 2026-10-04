import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
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

/** Resolve existing symlinks even when the final documents/control path is new. */
function canonicalize(path: string): string {
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
  exists: existsSync, read, canonicalize, isDirectory, homeDir: homedir,
};

function dependencies(overrides?: Partial<BacklogHomeDeps>): BacklogHomeDeps {
  return overrides === undefined ? filesystem : { ...filesystem, ...overrides };
}

function callerParams(params: LocalHomeResolutionParams): ResolveBacklogHomeParams {
  const { deps: _deps, ...caller } = params;
  return { ...caller, cwd: params.cwd?.trim() || process.cwd(), env: params.env ?? process.env };
}

/** Construct a canonical local home using the shared filesystem implementation. */
export function createBacklogHome(
  params: CreateBacklogHomeParams,
  overrides?: Partial<BacklogHomeDeps>,
): BacklogHome {
  return constructHome(params, dependencies(overrides));
}

/** Discover a local project boundary through the domain's bounded walk. */
export function discoverProjectRoot(params: LocalProjectRootParams): string | undefined {
  return discoverRoot(params, dependencies(params.deps));
}

/** Resolve caller defaults for existing CLI, bridge and server workflows. */
export function resolveBacklogHome(params: LocalHomeResolutionParams = {}): BacklogHome {
  return resolveCallerHome(callerParams(params), dependencies(params.deps));
}

/** Resolve a workspace-local home with the same filesystem and home constructor. */
export function resolveWorkspaceHome(params: LocalHomeResolutionParams = {}): BacklogHome {
  return resolveWorkspace(callerParams(params), dependencies(params.deps));
}
