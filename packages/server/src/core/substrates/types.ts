import type {
  AnyEntity,
  CompiledSubstrateIntent,
  RuntimeEntity,
  RuntimeSubstrateDefinition,
  SubstrateType,
} from '@backlog-mcp/shared';
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
  entity: AnyEntity;
}

export type SubstrateWriteValidationResult =
  | SubstrateWriteValidationFailure
  | SubstrateWriteValidationSuccess;

export interface CompiledSubstrateDefinition {
  kind: 'declarative';
  sourcePath: string;
  definition: RuntimeSubstrateDefinition;
  intents: readonly CompiledSubstrateIntent[];
  storageClaim: Readonly<SubstrateStorageClaim>;
  validateWrite(candidate: unknown): SubstrateWriteValidationResult;
}

export interface CompiledBuiltinSubstrate {
  kind: 'compiled';
  sourcePath: string;
  type: SubstrateType;
  intents: readonly CompiledSubstrateIntent[];
  storageClaim: Readonly<SubstrateStorageClaim>;
  validateWrite(candidate: unknown): SubstrateWriteValidationResult;
}

export type RegisteredSubstrate =
  | CompiledBuiltinSubstrate
  | CompiledSubstrateDefinition;

export interface SubstrateClaimSource {
  sourcePath: string;
  storageClaim: Readonly<SubstrateStorageClaim>;
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
  builtins?: readonly CompiledBuiltinSubstrate[];
  packaged: readonly CompiledSubstrateDefinition[];
  project: readonly CompiledSubstrateDefinition[];
  reservedToolNames?: readonly string[];
}

export interface CreateProjectSubstrateRegistryResult {
  registry: ProjectSubstrateRegistry;
  diagnostics: readonly SubstrateDefinitionDiagnostic[];
}

export interface LoadSubstrateDefinitionsParams {
  builtins?: readonly CompiledBuiltinSubstrate[];
  packagedDefinitions: readonly CompileSubstrateDefinitionParams[];
  declarations: readonly DiscoveredSubstrateDeclaration[];
  reservedToolNames?: readonly string[];
}

export type LoadSubstrateDefinitionsResult = CreateProjectSubstrateRegistryResult;

export interface ClaimedSubstrateDocument {
  document: DiscoveredDocument;
  type: string;
  /** Canonical path key with declared digit width retained for display formatting. */
  storageKey: string;
  /** Width-insensitive key used only for semantic collision detection. */
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
  substrates: readonly SubstrateClaimSource[];
}

export interface ClaimSubstrateDocumentsResult {
  claimed: readonly ClaimedSubstrateDocument[];
  diagnostics: readonly SubstrateDocumentCollisionDiagnostic[];
}
