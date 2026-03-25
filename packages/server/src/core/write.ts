import type { IBacklogService } from '../storage/service-types.js';
import { applyOperation } from '../resources/operations.js';
import { NotFoundError, type WriteParams, type WriteResult } from './types.js';

export async function writeBody(service: IBacklogService, params: WriteParams): Promise<WriteResult> {
  const { id, operation } = params;
  const task = await service.get(id);
  if (!task) throw new NotFoundError(id);

  try {
    const newBody = applyOperation(task.description ?? '', operation as any);
    await service.save({ ...task, description: newBody, updated_at: new Date().toISOString() });
    return { success: true, message: `Successfully applied ${operation.type} to ${id}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
