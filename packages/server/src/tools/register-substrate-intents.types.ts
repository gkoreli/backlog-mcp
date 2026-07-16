import type {
  CompiledSubstrateIntent,
  CompiledSubstrateIntentOperation,
} from '@backlog-mcp/shared';
import type {
  IntentRegistryPort,
  IntentWriteValidatorPort,
} from '../core/substrates/index.js';
import type { ToolDeps } from './index.js';

export type ExecutableSubstrateIntentOperationKind = Extract<
  CompiledSubstrateIntentOperation['kind'],
  'create' | 'transition' | 'set-field' | 'relate-and-transition'
>;

export interface SubstrateIntentQuarantineDiagnostic {
  code: 'substrate-intent-operation-not-executable';
  sourcePath: string;
  substrateType: string;
  verb: string;
  toolName: string;
  operationKind: Exclude<
    CompiledSubstrateIntentOperation['kind'],
    ExecutableSubstrateIntentOperationKind
  >;
  reason: string;
  escapePath: string;
}

export interface RegisterSubstrateIntentsOptions {
  intentRegistry: IntentRegistryPort;
  validator: IntentWriteValidatorPort;
  toolDeps: ToolDeps;
  reportQuarantine(diagnostic: SubstrateIntentQuarantineDiagnostic): void;
}

export interface RegisterSubstrateIntentsResult {
  registered: readonly CompiledSubstrateIntent[];
  quarantined: readonly SubstrateIntentQuarantineDiagnostic[];
}
