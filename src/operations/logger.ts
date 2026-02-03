import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { paths } from '@/utils/paths.js';

export interface OperationEntry {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  resourceId?: string;
}

const WRITE_TOOLS = ['backlog_create', 'backlog_update', 'backlog_delete', 'write_resource'];

/**
 * Extract resource ID from tool params or result for filtering.
 */
function extractResourceId(tool: string, params: Record<string, unknown>, result: unknown): string | undefined {
  // For backlog_create, ID is in the result
  if (tool === 'backlog_create') {
    const text = (result as any)?.content?.[0]?.text as string | undefined;
    if (text) {
      const match = text.match(/(TASK|EPIC)-\d+/);
      return match?.[0];
    }
  }
  
  if (tool === 'write_resource') {
    const uri = params.uri as string | undefined;
    if (uri) {
      const match = uri.match(/(TASK|EPIC)-\d+/);
      return match?.[0];
    }
  }
  
  // For backlog_update/delete, id is in params
  return params.id as string | undefined;
}

class OperationLogger {
  private logPath: string;

  constructor() {
    this.logPath = join(paths.backlogDataDir, '.internal', 'operations.jsonl');
  }

  /**
   * Log a tool operation. Only logs write operations.
   */
  log(tool: string, params: Record<string, unknown>, result: unknown): void {
    if (!WRITE_TOOLS.includes(tool)) return;

    const entry: OperationEntry = {
      ts: new Date().toISOString(),
      tool,
      params,
      result,
      resourceId: extractResourceId(tool, params, result),
    };

    try {
      const dir = dirname(this.logPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // Fail silently - logging should not break tool execution
    }
  }

  /**
   * Read recent operations, optionally filtered by task ID.
   */
  read(options: { limit?: number; taskId?: string } = {}): OperationEntry[] {
    const { limit = 50, taskId } = options;

    if (!existsSync(this.logPath)) return [];

    try {
      const content = readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      let entries: OperationEntry[] = lines
        .map(line => {
          try {
            return JSON.parse(line) as OperationEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is OperationEntry => e !== null);

      // Filter by task ID if specified
      if (taskId) {
        entries = entries.filter(e => e.resourceId === taskId);
      }

      // Return most recent first, limited
      return entries.reverse().slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Count operations for a specific task (for badge display).
   */
  countForTask(taskId: string): number {
    return this.read({ taskId, limit: 1000 }).length;
  }
}

export const operationLogger = new OperationLogger();
