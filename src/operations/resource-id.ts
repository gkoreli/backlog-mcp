/**
 * Resource ID extraction from tool params/results.
 * Each tool has its own extraction strategy.
 */

type Extractor = (params: Record<string, unknown>, result: unknown) => string | undefined;

const extractors: Record<string, Extractor> = {
  backlog_create: (_, result) => {
    const text = (result as any)?.content?.[0]?.text as string | undefined;
    if (text) {
      const match = text.match(/(TASK|EPIC)-\d+/);
      return match?.[0];
    }
    return undefined;
  },

  backlog_update: (params) => params.id as string | undefined,

  backlog_delete: (params) => params.id as string | undefined,

  write_resource: (params) => {
    const uri = params.uri as string | undefined;
    if (uri) {
      const match = uri.match(/(TASK|EPIC)-\d+/);
      return match?.[0];
    }
    return undefined;
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
