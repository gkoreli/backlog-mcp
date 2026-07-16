import type { BacklogHome } from '../../core/backlog-home.types.js';
import { discoverDocuments } from '../../core/document-discovery.js';
import {
  createBuiltinSubstrateRegistrations,
  loadProjectSubstrateDefinitions,
  type LoadSubstrateDefinitionsResult,
} from '../../core/substrates/index.js';
import type { SubstrateStorageCatalog } from '../substrate-storage-catalog.contract.js';
import { BuiltinSubstrateStorageCatalog } from './builtin-substrate-storage-catalog.js';

/** Compile the active storage/write registry for one home from its docs tree. */
export function loadHomeSubstrateRegistry(
  home: BacklogHome,
  catalog: SubstrateStorageCatalog = new BuiltinSubstrateStorageCatalog(),
  reservedToolNames: readonly string[] = [],
): LoadSubstrateDefinitionsResult {
  const discovery = discoverDocuments({ documentsDir: home.documentsDir });
  return loadProjectSubstrateDefinitions(
    discovery.declarations,
    createBuiltinSubstrateRegistrations(catalog),
    reservedToolNames,
  );
}
