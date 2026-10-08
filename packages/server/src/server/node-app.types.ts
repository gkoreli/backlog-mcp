import type { RecentHomesStore } from '../storage/local/recent-homes-store.js';
import type { ReleaseStatus } from '../core/installed-version.js';
import type {
  AppRequestRuntime,
  AppRequestRuntimeResolver,
  CorpusCheckerResolver,
} from '../composition/app-request-runtime.types.js';

/** Construction options for the Node Hono application graph. */
export interface CreateNodeAppOptions {
  runtime: AppRequestRuntime;
  skipStatic?: boolean;
  resolveRuntime?: AppRequestRuntimeResolver;
  resolveCorpusChecker?: CorpusCheckerResolver;
  requestShutdown?: () => void | Promise<void>;
  /** Recent-homes registry (ADR 0128), exposed via GET/DELETE /api/homes. */
  recentHomes?: RecentHomesStore;
  /** Release awareness + self-restart (ADR 0131), exposed via /api/release and /api/restart. */
  readReleaseStatus?: () => ReleaseStatus;
  requestRestart?: () => void;
}
