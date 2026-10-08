/** Read-only corpus integrity contracts over one supplied snapshot (ADR 0113.4). */
import type { DocumentDiscoveryResult } from './document-discovery.types.js';
import type { YamlCodec } from './markdown-frontmatter.contract.js';
import type { ProjectSubstrateRegistry } from './substrates/project-substrate-registry.js';
import type { SubstrateDefinitionDiagnostic } from './substrates/types.js';

export interface CheckCorpusParams {
  homeKey: string;
  discovery: DocumentDiscoveryResult;
  registry: Pick<ProjectSubstrateRegistry, 'listSubstrates' | 'getStorageClaim' | 'validateWrite' | 'listRelations'>;
  registryDiagnostics: readonly SubstrateDefinitionDiagnostic[];
  yaml: YamlCodec;
}

export interface CorpusCheckDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  source_path: string;
  field?: string;
  entity_id?: string;
  related_ids?: readonly string[];
  message: string;
}

export interface CorpusCheckReport {
  version: 1;
  complete: boolean;
  valid: boolean;
  summary: { documents: number; entities: number; resources: number; errors: number; warnings: number };
  diagnostics: CorpusCheckDiagnostic[];
}

export interface CorpusCheckerPort {
  check(): CorpusCheckReport | Promise<CorpusCheckReport>;
}

export interface CheckedCorpusEntity {
  id: string;
  type: string;
  source_path: string;
  data: Readonly<Record<string, unknown>>;
}
