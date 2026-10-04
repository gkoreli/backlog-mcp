import type { DiscoveredSubstrateDeclaration } from '../../core/document-discovery.types.js';
/** Real local repository graph over the suite's memfs (ADR 0135). */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OramaSearchService } from '@backlog-mcp/memory/search';
import { createBacklogHome } from '../../storage/local/backlog-home.js';
import { BacklogService } from '../../storage/local/backlog-service.js';
import { DocsNativeFilesystemStorage } from '../../storage/local/docs-native-filesystem-storage.js';
import { BuiltinSubstrateStorageCatalog } from '../../storage/local/builtin-substrate-storage-catalog.js';
import { createBuiltinSubstrateRegistrations, loadProjectSubstrateDefinitions } from '../../core/substrates/index.js';
import { ResourceManager } from '../../resources/manager.js';

/** Construct an isolated authoritative Markdown repository and derived index. */
export function localHome(name: string, declarations: readonly DiscoveredSubstrateDeclaration[] = []) {
  const root = join(tmpdir(), 'domain-flows', name);
  mkdirSync(join(root, 'docs'), { recursive: true });
  const home = createBacklogHome({ kind: 'project', root });
  const registry = loadProjectSubstrateDefinitions(declarations, createBuiltinSubstrateRegistrations(new BuiltinSubstrateStorageCatalog())).registry;
  const storage = new DocsNativeFilesystemStorage(home, registry);
  const search = new OramaSearchService({ cachePath: join(home.controlDir, 'cache/search.json'), hybridSearch: false });
  const resourceManager = new ResourceManager(home.root, home.documentsDir);
  const service = new BacklogService({ storage, search, resourceManager, getSearchFields: registry.getSearchFields.bind(registry) });
  return { home, registry, storage, search, resourceManager, service };
}
