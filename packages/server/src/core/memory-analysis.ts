/** Complete memory observation read; supplied time and home-owned capabilities are explicit. */
import { EntityType } from '@backlog-mcp/shared';
import type { EntityCorpusReadPort } from './entity-corpus.contract.js';
import type { IBacklogService } from './backlog-service.contract.js';
import { readEntityCorpus } from './entity-corpus.js';
import { createMemoryAnalysisView, type MemoryAnalysisView } from './memory-analysis-view.js';

/** Complete reads and ranked neighbors remain separate capabilities. */
export type MemoryAnalysisReader = Partial<EntityCorpusReadPort> & Pick<IBacklogService, 'searchUnified'>;

/** Missing complete reads fail visibly; never use a display/search page as a corpus. */
export async function readMemoryAnalysisView(reader: Partial<EntityCorpusReadPort>, now: number): Promise<MemoryAnalysisView> {
  return createMemoryAnalysisView(await readEntityCorpus(reader, { type: EntityType.Memory }), now);
}
