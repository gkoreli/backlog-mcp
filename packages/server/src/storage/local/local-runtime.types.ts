import type { OramaSearchService } from '@backlog-mcp/memory/search';
import type { BacklogHome } from '../../core/backlog-home.types.js';
import type {
  DocsTreeWatcher,
  DocsTreeWatcherErrorCallback,
} from './docs-tree-watcher.contract.js';
import type { SubstrateStorageCatalog } from '../substrate-storage-catalog.contract.js';

/** Injectable construction seams for one local backlog runtime. */
export interface LocalRuntimeDependencies {
  catalog?: SubstrateStorageCatalog;
  watcher?: DocsTreeWatcher;
  createSearch?: (home: BacklogHome) => OramaSearchService;
  onWatcherError?: DocsTreeWatcherErrorCallback;
  /** Retired custom global root, used only by the fail-closed migration guard. */
  legacyRoot?: string;
}
