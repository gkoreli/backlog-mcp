import type { SubstrateDefinitionIssue } from './types.js';

/** Strict canonical-write rejection from the active substrate registry. */
export class SubstrateWriteError extends Error {
  constructor(
    readonly type: string,
    readonly issues: readonly SubstrateDefinitionIssue[],
  ) {
    super(issues.map(function formatIssue(issue) {
      return `${issue.path}: ${issue.message}`;
    }).join('; '));
    this.name = 'SubstrateWriteError';
  }
}
