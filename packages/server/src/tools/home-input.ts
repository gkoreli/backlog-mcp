import { z } from 'zod';

/** Transport-only home selection fields shared by every backlog MCP tool. */
export const BACKLOG_HOME_INPUT_FIELDS = {
  home: z.enum(['global', 'project']).optional().describe(
    'Select the document home for this call. Overrides bridge defaults: global uses the user-wide home; project uses project_root or the bridge project.',
  ),
  project_root: z.string().min(1).optional().describe(
    'Project root for this call. Overrides the bridge project root and selects the project home.',
  ),
};
