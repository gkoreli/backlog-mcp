import type { CompiledSubstrateIntent } from '@backlog-mcp/shared';
import type { SubstrateWriteValidationResult } from './types.js';

/** Read-only compiled intent catalog consumed by MCP registration. */
export interface IntentRegistryPort {
  listIntents(): readonly CompiledSubstrateIntent[];
}

/** Canonical postimage validator consumed by the core intent executor. */
export interface IntentWriteValidatorPort {
  validateWrite(candidate: unknown): SubstrateWriteValidationResult;
}
