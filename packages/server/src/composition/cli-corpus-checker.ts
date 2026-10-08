/** Resolve CLI selection for diagnostics without constructing a managed runtime. */
import { validateHomeSelection } from '../core/backlog-home-selection.js';
import type { CorpusCheckerPort } from '../core/corpus-check.contract.js';
import { resolveBacklogHome } from '../storage/local/backlog-home.js';
import type { LocalHomeResolutionParams } from '../storage/local/backlog-home.types.js';
import { createCorpusChecker } from './corpus-checker.js';

/** Use existing home selection while avoiding recent-home and startup writes. */
export function createCliCorpusChecker(params: LocalHomeResolutionParams = {}): CorpusCheckerPort {
  const selection = params.home === undefined && params.projectRoot === undefined
    ? undefined
    : validateHomeSelection(params);
  const home = resolveBacklogHome({
    ...params,
    home: selection?.home,
    projectRoot: selection?.projectRoot,
  });
  return createCorpusChecker(home);
}
