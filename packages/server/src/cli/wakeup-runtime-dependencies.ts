import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { discoverProjectRoot } from '../core/backlog-home.js';
import { resolveWorkspaceProjectRoot } from '../core/workspace-project-root.js';
import type { CliRunnerDependencies } from './runner.types.js';

function discoverRoot(cwd: string): string | undefined {
  return discoverProjectRoot({ startDir: cwd });
}

function canonicalize(path: string): string {
  return realpathSync(resolve(path));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Wakeup requires workspace-local selection unless the CLI explicitly names
 * global/all. Passing both project fields prevents inherited home/root defaults
 * from widening or redirecting this session's briefing.
 */
export function wakeupRuntimeDependencies(
  deps: CliRunnerDependencies,
): CliRunnerDependencies {
  if (deps.home === 'global' || deps.home === 'all') return deps;
  const projectRoot = resolveWorkspaceProjectRoot({
    cwd: deps.cwd ?? process.cwd(),
    ...(deps.projectRoot === undefined ? {} : { projectRoot: deps.projectRoot }),
  }, { discoverRoot, canonicalize, isDirectory });
  return { ...deps, home: 'project', projectRoot };
}
