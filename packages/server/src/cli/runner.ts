import { BacklogService } from '../storage/backlog-service.js';
import { NotFoundError, ValidationError } from '../core/types.js';

export async function run<R>(
  handler: (service: BacklogService) => Promise<R>,
  format: (result: R) => string,
  json: boolean,
): Promise<void> {
  try {
    const service = BacklogService.getInstance();
    const result = await handler(service);
    console.log(json ? JSON.stringify(result, null, 2) : format(result));
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
