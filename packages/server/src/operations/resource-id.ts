/**
 * Resource ID extraction from tool params/results.
 * Each tool has its own extraction strategy.
 */

type Extractor = (params: Record<string, unknown>, result: unknown) => string | undefined;

const ID_RE = /(TASK|EPIC|FLDR|ARTF|MLST)-\d+/;

const extractors: Record<string, Extractor> = {
  backlog_create: (_, result) => {
    // Core result: { id: "TASK-0001" }
    const directId = (result as any)?.id as string | undefined;
    if (directId && ID_RE.test(directId)) return directId;
    // MCP result: { content: [{ text: "Created TASK-0001" }] }
    const text = (result as any)?.content?.[0]?.text as string | undefined;
    return text ? ID_RE.exec(text)?.[0] : undefined;
  },

  backlog_update: (params) => params.id as string | undefined,

  backlog_delete: (params) => params.id as string | undefined,

  write_resource: (params) => {
    // New format: { id: "TASK-0001" }
    const id = params.id as string | undefined;
    if (id) return id;
    // Old format: { uri: "mcp://backlog/tasks/TASK-0001.md" }
    const uri = params.uri as string | undefined;
    return uri ? ID_RE.exec(uri)?.[0] : undefined;
  },
};

/**
 * Extract resource ID from tool params or result for filtering.
 */
export function extractResourceId(
  tool: string,
  params: Record<string, unknown>,
  result: unknown
): string | undefined {
  const extractor = extractors[tool];
  return extractor ? extractor(params, result) : undefined;
}

/**
 * Extract a display filename for write_resource operations.
 * Handles both old URI format and new ID format.
 *
 * Old: { uri: "mcp://backlog/tasks/TASK-0001.md" } → "TASK-0001.md"
 * New: { id: "TASK-0001" }                         → "TASK-0001.md"
 *
 * Returns undefined for non-write_resource tools.
 */
export function extractTargetFilename(
  tool: string,
  params: Record<string, unknown>,
): string | undefined {
  if (tool !== 'write_resource') return undefined;
  const uri = params.uri as string | undefined;
  if (uri) return uri.split('/').pop() ?? undefined;
  const id = params.id as string | undefined;
  return id ? `${id}.md` : undefined;
}
