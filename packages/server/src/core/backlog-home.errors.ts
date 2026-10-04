import { ValidationError } from './types.js';

/** Error raised when an explicitly selected home cannot be resolved safely. */
export class BacklogHomeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BacklogHomeResolutionError';
  }
}

/** Workspace selection failure; adapters supply their own recovery instructions. */
export class WorkspaceHomeResolutionError extends ValidationError {
  constructor(
    readonly reason: 'missing-boundary' | 'invalid-root',
    readonly projectRoot?: string,
  ) {
    super(reason === 'missing-boundary'
      ? 'No project boundary found'
      : 'Project root must be an existing directory'
        + (projectRoot === undefined ? '' : `: ${projectRoot}`));
    this.name = 'WorkspaceHomeResolutionError';
  }
}
