/** HTTP selects a home; each event stream owns only that home's subscription. */
import type { Hono, HonoRequest } from 'hono';
import type { AppRequestRuntime } from '../composition/app-request-runtime.types.js';
import { createEventStreamResponse } from './event-stream.js';
import { getHomeProvenance } from './home-provenance.js';

/** Mount the unchanged event grammar with a request-owned lifecycle (ADR 0136). */
export function registerEventRoutes(app: Hono, resolveRuntime: (request: HonoRequest) => Promise<AppRequestRuntime>): void {
  app.get('/events', async function readEvents(c) {
    const runtime = await resolveRuntime(c.req);
    return createEventStreamResponse({
      events: runtime.eventBus,
      signal: c.req.raw.signal,
      projectEvent: function eventPayload(event) {
        return { ...event, ...getHomeProvenance(runtime, runtime.getSourcePath?.(event.id)) };
      },
    });
  });
}
