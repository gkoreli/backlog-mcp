/**
 * `write_resource` edit-operation types — the shared contract for body edits.
 *
 * One definition per concept (ADR 0106.1): the operation shape is produced by
 * the MCP `write_resource` tool, applied by the server's `applyOperation`,
 * recorded in the operation log, and consumed by the viewer's diff renderer.
 * It therefore lives in `@backlog-mcp/shared` so server and viewer share a
 * single source of truth instead of each maintaining a copy.
 */

export type OperationType = 'str_replace' | 'insert' | 'append';

export interface StrReplaceOperation {
  type: 'str_replace';
  old_str: string;
  new_str: string;
}

export interface InsertOperation {
  type: 'insert';
  insert_line: number;
  new_str: string;
}

export interface AppendOperation {
  type: 'append';
  new_str: string;
}

export type Operation = StrReplaceOperation | InsertOperation | AppendOperation;

/**
 * Loose boundary form of an edit operation: every field optional, `type` as a
 * plain literal set. Used where the operation arrives as untyped JSON and has
 * not been validated into the strict {@link Operation} union yet — i.e. core
 * `EditParams` (input from the MCP tool) and the viewer (operation-log params).
 * `applyOperation` narrows this to a strict {@link Operation} at apply time.
 */
export interface EditOperation {
  type: OperationType;
  old_str?: string;
  new_str?: string;
  insert_line?: number;
}
