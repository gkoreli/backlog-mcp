import type { CompiledSubstrateIntent } from '@backlog-mcp/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  executeSubstrateIntent,
  SubstrateIntentExecutionError,
} from '../core/substrates/index.js';
import type { IBacklogService } from '../storage/backlog-service.contract.js';
import { buildWriteContext } from './build-write-context.js';
import type {
  RegisterSubstrateIntentsOptions,
  RegisterSubstrateIntentsResult,
  SubstrateIntentQuarantineDiagnostic,
} from './register-substrate-intents.types.js';

const QUARANTINE_REASON =
  'operation kind not yet executable — 0106.5 R5 initial-16 scope';
const QUARANTINE_ESCAPE_PATH =
  'The first real project declaration needing relate or append-relation triggers implementation.';

function isExecutableIntent(intent: CompiledSubstrateIntent): boolean {
  return intent.operation.kind === 'create'
    || intent.operation.kind === 'transition'
    || intent.operation.kind === 'set-field'
    || intent.operation.kind === 'relate-and-transition';
}

function quarantineDiagnostic(
  intent: CompiledSubstrateIntent,
): SubstrateIntentQuarantineDiagnostic {
  if (intent.operation.kind !== 'relate' && intent.operation.kind !== 'append-relation') {
    throw new Error(`Unexpected non-executable operation: ${intent.operation.kind}`);
  }
  return {
    code: 'substrate-intent-operation-not-executable',
    sourcePath: intent.sourcePath,
    substrateType: intent.substrateType,
    verb: intent.verb,
    toolName: intent.toolName,
    operationKind: intent.operation.kind,
    reason: QUARANTINE_REASON,
    escapePath: QUARANTINE_ESCAPE_PATH,
  };
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof SubstrateIntentExecutionError) {
    return {
      error: error.message,
      code: error.code,
      ids: error.ids,
      ...(error.compensationSucceeded === undefined
        ? {}
        : { compensation_succeeded: error.compensationSucceeded }),
    };
  }
  return {
    error: error instanceof Error ? error.message : String(error),
  };
}

function createIntentHandler(
  intent: CompiledSubstrateIntent,
  service: IBacklogService,
  options: RegisterSubstrateIntentsOptions,
) {
  return async function handleSubstrateIntent(
    input: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }> {
    try {
      const result = await executeSubstrateIntent({
        intent,
        input,
        service,
        validator: options.validator,
        context: buildWriteContext(options.toolDeps),
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(errorPayload(error)),
        }],
        isError: true,
      };
    }
  };
}

/**
 * Register compiler-owned semantic write tools without reopening declarations.
 *
 * Unsupported operation kinds are reported as visible quarantine diagnostics
 * and are never exposed as tools that can only fail at invocation time.
 */
export function registerSubstrateIntents(
  server: McpServer,
  service: IBacklogService,
  options: RegisterSubstrateIntentsOptions,
): RegisterSubstrateIntentsResult {
  const registered: CompiledSubstrateIntent[] = [];
  const quarantined: SubstrateIntentQuarantineDiagnostic[] = [];

  for (const intent of options.intentRegistry.listIntents()) {
    if (!isExecutableIntent(intent)) {
      const diagnostic = quarantineDiagnostic(intent);
      quarantined.push(diagnostic);
      options.reportQuarantine(diagnostic);
      continue;
    }
    server.registerTool(
      intent.toolName,
      {
        description: intent.description,
        inputSchema: intent.intentInputSchema,
      },
      createIntentHandler(intent, service, options),
    );
    registered.push(intent);
  }

  return { registered, quarantined };
}
