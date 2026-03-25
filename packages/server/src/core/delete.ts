import type { IBacklogService } from '../storage/service-types.js';
import type { DeleteResult } from './types.js';

export async function deleteItem(service: IBacklogService, id: string): Promise<DeleteResult> {
  await service.delete(id);
  return { id };
}
