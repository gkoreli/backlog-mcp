import type { IBacklogService } from '../storage/service-types.js';
import type { GetResult } from './types.js';

function isResourceUri(id: string): boolean {
  return id.startsWith('mcp://backlog/');
}

async function fetchItem(id: string, service: IBacklogService): Promise<string> {
  if (isResourceUri(id)) {
    const resource = service.getResource?.(id);
    if (!resource) return `Not found: ${id}`;
    const header = `# Resource: ${id}\nMIME: ${resource.mimeType}`;
    const frontmatterStr = resource.frontmatter
      ? `\nFrontmatter: ${JSON.stringify(resource.frontmatter)}`
      : '';
    return `${header}${frontmatterStr}\n\n${resource.content}`;
  }
  return (await service.getMarkdown(id)) || `Not found: ${id}`;
}

export async function getItems(service: IBacklogService, ids: string[]): Promise<GetResult> {
  if (ids.length === 0) throw new Error('Required: id');
  const results = await Promise.all(ids.map((id) => fetchItem(id, service)));
  return { content: results.join('\n\n---\n\n') };
}
