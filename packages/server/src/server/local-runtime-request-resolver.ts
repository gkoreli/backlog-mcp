/** Per-request home runtime selection for the detached HTTP server (ADR 0112 R-2). */
import { resolveBacklogHome } from '../storage/local/backlog-home.js';
import { validateHomeSelection } from '../core/backlog-home-selection.js';
import type { HomeSelectionRequest } from '../core/backlog-home-selection.types.js';
import { resolveGitFamily } from '../storage/local/git-family.js';
import { LocalRuntimeRegistry } from '../storage/local/local-runtime-registry.js';
import type { LocalRuntime } from '../storage/local/local-runtime.js';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { LocalRuntimeRequestResolverOptions } from './local-runtime-request-resolver.types.js';

/**
 * Resolve and lazily start the per-home runtime selected by one request.
 *
 * The detached server process is deliberately not a source of caller context:
 * request headers/query parameters must carry project selection explicitly.
 */
export class LocalRuntimeRequestResolver {
  constructor(
    private readonly registry: LocalRuntimeRegistry,
    private readonly options: LocalRuntimeRequestResolverOptions = {},
  ) {}

  async resolve(
    selection: HomeSelectionRequest = {},
  ): Promise<LocalRuntime> {
    return this.registry.get(this.resolveHome(selection));
  }

  /** Resolve the same request home without starting services (ADR 0113.4). */
  resolveHome(selection: HomeSelectionRequest = {}): BacklogHome {
    const validated = validateHomeSelection(selection);
    const home = resolveBacklogHome({
      home: validated.home,
      projectRoot: validated.projectRoot,
      globalRoot: this.options.globalRoot,
      env: {},
      // Family awareness (LATTICE W1): a request selecting a linked-
      // worktree project root resolves a family-aware home; everyone
      // else is unchanged.
      deps: { resolveFamily: resolveGitFamily },
    });
    return home;
  }
}
