/** HTTP header/query selection; ambient defaults belong to local resolution (ADR 0136). */
import { BACKLOG_HOME_HEADER, BACKLOG_PROJECT_ROOT_HEADER } from '../core/backlog-home.js';
import type { AppRequestRuntimeSelection } from '../composition/app-request-runtime.types.js';

export interface RequestSelectionSource {
  header(name: string): string | undefined;
  query(name: string): string | undefined;
}

/**
 * Read explicit caller context from one HTTP request.
 *
 * Headers are the bridge/server contract and therefore win over viewer query
 * parameters. Missing values remain missing; server cwd and process env are
 * deliberately not request-selection inputs.
 */
export function selectAppRequestRuntime(
  request: RequestSelectionSource,
): AppRequestRuntimeSelection {
  const home = request.header(BACKLOG_HOME_HEADER) ?? request.query('home');
  const projectRoot = request.header(BACKLOG_PROJECT_ROOT_HEADER)
    ?? request.query('project_root');

  return {
    ...(home === undefined ? {} : { home }),
    ...(projectRoot === undefined ? {} : { projectRoot }),
  };
}

