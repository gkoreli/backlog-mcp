import type { RuntimeSubstrateDefinition } from '@backlog-mcp/shared';
import type { SubstrateStorageClaim } from '../../storage/substrate-storage-catalog.contract.js';

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
