import { z } from 'zod';
import type { HomeReadCoordinator } from '../core/home-read-coordinator.types.js';
import { ValidationError } from '../core/types.js';

const PROJECT_ROOT_INPUT = z.string().min(1).optional().describe(
  'Project root for this call. Overrides the bridge project root and selects the project home.',
);

/** Transport-only home selection fields shared by every backlog MCP tool. */
export const BACKLOG_HOME_INPUT_FIELDS = {
  home: z.enum(['global', 'project']).optional().describe(
    'Select the document home for this call. Overrides bridge defaults: global uses the user-wide home; project uses project_root or the bridge project.',
  ),
  project_root: PROJECT_ROOT_INPUT,
};

/** Read-only selection fields for the three cross-home verbs. */
export const BACKLOG_READ_HOME_INPUT_FIELDS = {
  home: z.enum(['global', 'project', 'all']).optional().describe(
    'Select the document home for this read. "all" queries global plus the explicitly supplied/bridged project root; it never scans prior projects.',
  ),
  project_root: PROJECT_ROOT_INPUT,
};

/** Require the local-only coordinator after a read tool selects home:all. */
export function requireHomeReadCoordinator(
  coordinator: HomeReadCoordinator | undefined,
): HomeReadCoordinator {
  if (coordinator === undefined) {
    throw new ValidationError(
      'home "all" requires the docs-native local runtime',
    );
  }
  return coordinator;
}
