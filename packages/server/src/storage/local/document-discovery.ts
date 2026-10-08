/** Local discovery defaults; domain classification/walking consumes explicit read capabilities. */
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { bunYamlCodec } from './bun-yaml-codec.js';
import { discoverDocuments as discoverWith } from '../../core/document-discovery.js';
import type { DiscoverDocumentsParams, DocumentDiscoveryDependencies } from '../../core/document-discovery.types.js';

export type LocalDiscoverDocumentsParams = Omit<DiscoverDocumentsParams, 'dependencies'> & { dependencies?: Partial<DocumentDiscoveryDependencies> };
const LOCAL_READS: DocumentDiscoveryDependencies = {
  yaml: bunYamlCodec,
  readDirectory: function readDirectory(path) { return readdirSync(path, { encoding: 'utf8' }); },
  readFile: function readFile(path) { return readFileSync(path, 'utf8'); },
  lstat: lstatSync, stat: statSync, realpath: realpathSync,
  getGitFirstAddDate: function noGitFirstAddDate() { return undefined; },
};

/** Preserve the local discovery entrypoint and explicit per-operation overrides. */
export function discoverDocuments(params: LocalDiscoverDocumentsParams) {
  return discoverWith({ ...params, dependencies: { ...LOCAL_READS, ...params.dependencies } });
}
