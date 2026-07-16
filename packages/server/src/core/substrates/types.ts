import type { RuntimeSubstrateDefinition } from '@backlog-mcp/shared';
import type {
  DiscoveredDocument,
  DiscoveredSubstrateDeclaration,
} from '../document-discovery.types.js';
import type { SubstrateStorageClaim } from '../../storage/substrate-storage-catalog.contract.js';
import type { ProjectSubstrateRegistry } from './project-substrate-registry.js';

export type SubstrateDefinitionIssueCode =
  | 'compile'
  | 'limit'
  | 'shape'
  | 'unsafe'
  | 'unsupported';

export interface SubstrateDefinitionIssue {
  code: SubstrateDefinitionIssueCode;
  path: string;
  message: string;
}

export interface SubstrateDefinitionDiagnostic {
  code: 'invalid-substrate-definition';
  sourcePath: string;
  type?: string;
  issues: readonly SubstrateDefinitionIssue[];
}

export interface SubstrateWriteValidationFailure {
  ok: false;
  issues: readonly SubstrateDefinitionIssue[];
}

export interface SubstrateWriteValidationSuccess {
  ok: true;
}

export type SubstrateWriteValidationResult =
  | SubstrateWriteValidationFailure
  | SubstrateWriteValidationSuccess;

export interface CompiledSubstrateDefinition {
  sourcePath: string;
  definition: RuntimeSubstrateDefinition;
  storageClaim: Readonly<SubstrateStorageClaim>;
  validateWrite(candidate: unknown): SubstrateWriteValidationResult;
}

export interface CompileSubstrateDefinitionParams {
  sourcePath: string;
  value: unknown;
  content?: string;
}

export type CompileSubstrateDefinitionResult =
  | {
    ok: true;
    substrate: CompiledSubstrateDefinition;
  }
  | {
    ok: false;
    diagnostic: SubstrateDefinitionDiagnostic;
  };

export interface CreateProjectSubstrateRegistryParams {
  packaged: readonly CompiledSubstrateDefinition[];
  project: readonly CompiledSubstrateDefinition[];
}

export interface CreateProjectSubstrateRegistryResult {
  registry: ProjectSubstrateRegistry;
  diagnostics: readonly SubstrateDefinitionDiagnostic[];
}

export interface LoadSubstrateDefinitionsParams {
  packagedDefinitions: readonly CompileSubstrateDefinitionParams[];
  declarations: readonly DiscoveredSubstrateDeclaration[];
}

export type LoadSubstrateDefinitionsResult = CreateProjectSubstrateRegistryResult;

export interface ClaimedSubstrateDocument {
  document: DiscoveredDocument;
  type: string;
  semanticKey: string;
}

export interface SubstrateDocumentCollisionDiagnostic {
  code: 'duplicate-substrate-document';
  homeKey: string;
  type: string;
  semanticKey: string;
  sourcePaths: readonly string[];
}

export interface ClaimSubstrateDocumentsParams {
  homeKey: string;
  documents: readonly DiscoveredDocument[];
  substrates: readonly CompiledSubstrateDefinition[];
}

export interface ClaimSubstrateDocumentsResult {
  claimed: readonly ClaimedSubstrateDocument[];
  diagnostics: readonly SubstrateDocumentCollisionDiagnostic[];
}
