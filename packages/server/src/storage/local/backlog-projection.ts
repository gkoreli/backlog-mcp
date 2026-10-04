/** Snapshot projection: one Markdown document participates in one index family. */
import type { StorageAdapter, DocumentStorageAdapter } from '../storage-adapter.js';
import type { BacklogServiceDependencies } from './backlog-service.types.js';
import { createSearchEntityDocument } from '../../core/substrates/create-search-entity-document.js';

export function isDocumentStorageAdapter(
  storageAdapter: StorageAdapter,
): storageAdapter is DocumentStorageAdapter {
  return 'iterateDocuments' in storageAdapter
    && typeof storageAdapter.iterateDocuments === 'function';
}

/**
 * Typed entity Markdown is indexed through the entity collection. Excluding
 * its source path here prevents one document from appearing again as a
 * generic resource in docs-native homes.
 */
export function listIndexableResources(
  storageAdapter: StorageAdapter,
  manager: BacklogServiceDependencies['resourceManager'],
) {
  const resources = manager.list();
  if (!isDocumentStorageAdapter(storageAdapter)) return resources;

  // Entity source paths are documents-dir-relative; resource paths are
  // root-relative — align through the manager's scan prefix.
  const scanPrefix = manager.scanPrefix;
  const entitySourcePaths = new Set(Array.from(
    storageAdapter.iterateDocuments(),
  ).map(function getCompiledSourcePath(document) {
    return scanPrefix === ''
      ? document.sourcePath
      : `${scanPrefix}/${document.sourcePath}`;
  }));
  return resources.filter(function isGenericResource(resource) {
    return !entitySourcePaths.has(resource.path);
  });
}

/** Supply the complete entity projection for reconciliation without rebuilding it in the service. */
export function entityIndexSnapshot(storage: StorageAdapter, fields: BacklogServiceDependencies['getSearchFields']) {
  return Array.from(storage.iterateEntities()).flatMap(function project(entity) {
    const document = createSearchEntityDocument(entity, fields);
    return document === undefined ? [] : [document];
  });
}
