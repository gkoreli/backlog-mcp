import { ValidationError } from './types.js';

/** Caller-owned filesystem capabilities for workspace selection. */
export interface WorkspaceProjectRootDependencies {
  discoverRoot: (cwd: string) => string | undefined;
  canonicalize: (path: string) => string;
  isDirectory: (path: string) => boolean;
}

/**
 * Select an explicit root or the nearest workspace boundary, never another
 * home's defaults. A workspace need not have a documents directory yet.
 */
export function resolveWorkspaceProjectRoot(
  params: { cwd: string; projectRoot?: string },
  deps: WorkspaceProjectRootDependencies,
): string {
  if (params.projectRoot !== undefined && !params.projectRoot.trim()) {
    throw new ValidationError(
      'Project root must be an existing directory; pass --project-root <path>',
    );
  }
  const selected = params.projectRoot?.trim() ?? deps.discoverRoot(params.cwd);
  if (selected === undefined) {
    throw new ValidationError(
      'No project boundary found for wakeup; run inside a project, pass '
      + '--project-root <path>, or explicitly select --home global',
    );
  }
  if (!deps.isDirectory(selected)) {
    throw new ValidationError(
      `Project root must be an existing directory: ${selected}; pass --project-root <path>`,
    );
  }
  return deps.canonicalize(selected);
}
