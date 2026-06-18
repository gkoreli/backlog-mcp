// Operation types for write_resource live in @backlog-mcp/shared
// (single source of truth — server applies them, viewer renders them).

export interface WriteResourceResult {
  success: boolean;
  message: string;
  error?: string;
}
