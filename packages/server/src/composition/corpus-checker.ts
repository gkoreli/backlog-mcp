/** Assemble a read-only corpus check without starting search or write services. */
import type { BacklogHome } from '../core/backlog-home.types.js';
import type { CorpusCheckerPort } from '../core/corpus-check.contract.js';
import { checkCorpus } from '../core/corpus-check.js';
import {
  createBuiltinSubstrateRegistrations,
  loadProjectSubstrateDefinitions,
} from '../core/substrates/index.js';
import { RESERVED_TOOL_NAMES } from '../core/substrates/tool-name-reservations.js';
import { BuiltinSubstrateStorageCatalog } from '../storage/local/builtin-substrate-storage-catalog.js';
import { bunYamlCodec } from '../storage/local/bun-yaml-codec.js';
import { discoverDocuments } from '../storage/local/document-discovery.js';

/** Capture one filesystem snapshot and validate it through core (ADR 0113.4). */
export function createCorpusChecker(home: BacklogHome): CorpusCheckerPort {
  return {
    check: function checkSelectedHome() {
      const discovery = discoverDocuments({ documentsDir: home.documentsDir });
      const loaded = loadProjectSubstrateDefinitions(
        discovery.declarations,
        createBuiltinSubstrateRegistrations(new BuiltinSubstrateStorageCatalog()),
        RESERVED_TOOL_NAMES,
        discovery.substrateHistory,
      );
      return checkCorpus({
        homeKey: home.id,
        discovery,
        registry: loaded.registry,
        registryDiagnostics: loaded.diagnostics,
        yaml: bunYamlCodec,
      });
    },
  };
}
