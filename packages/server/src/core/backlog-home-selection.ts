/**
 * Validate a caller's home selection before resolving it (ADR 0112 R-2, R-8).
 * Pure: it never consults a process's cwd or environment, so every adapter
 * (HTTP headers, CLI flags) gets the same answer (ADR 0134.1 R3.3).
 */
import { BacklogHomeResolutionError } from './backlog-home.js';
import type { BacklogHomeSelector } from './backlog-home.types.js';
import type {
  HomeSelectionRequest,
  ValidatedHomeSelection,
} from './backlog-home-selection.types.js';

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseHomeSelector(value: string | undefined): BacklogHomeSelector | undefined {
  const selected = clean(value);
  if (selected === undefined) return undefined;
  if (selected === 'global' || selected === 'project') return selected;
  throw new BacklogHomeResolutionError(
    `Invalid backlog home "${selected}"; expected "global" or "project"`,
  );
}

/**
 * Validate one explicit selection. A missing selection means global; a
 * project root alone implies a project home.
 */
export function validateHomeSelection(
  selection: HomeSelectionRequest = {},
): ValidatedHomeSelection {
  const selectedHome = parseHomeSelector(selection.home);
  const projectRoot = clean(selection.projectRoot);

  if (selectedHome === 'global' && projectRoot !== undefined) {
    throw new BacklogHomeResolutionError(
      'Project root cannot be combined with home "global"',
    );
  }
  if (selectedHome === 'project' && projectRoot === undefined) {
    throw new BacklogHomeResolutionError(
      'Project home requires an explicit project root',
    );
  }

  return {
    home: selectedHome ?? (projectRoot === undefined ? 'global' : 'project'),
    ...(projectRoot === undefined ? {} : { projectRoot }),
  };
}
