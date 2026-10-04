/** Request-owned SSE subscription and heartbeat lifetime (ADR 0136 R6). */
import type { BacklogEvent, EventBus } from '../events/event-bus.js';

/** SSE consumes reads only; it cannot emit mutations or replay another home. */
export interface EventStreamSource {
  events?: Pick<EventBus, 'subscribe' | 'unsubscribe'>;
  signal: AbortSignal;
  projectEvent: (event: BacklogEvent) => unknown;
}

/** Preserve SSE framing and retire effects on cancel, abort or projection failure. */
export function createEventStreamResponse(source: EventStreamSource): Response {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let retired = false;
  let subscribed = false;

  function cleanup(): void {
    if (retired) return;
    retired = true;
    source.signal.removeEventListener('abort', onAbort);
    if (heartbeat !== undefined) clearInterval(heartbeat);
    if (subscribed) {
      subscribed = false;
      try {
        source.events?.unsubscribe(onEvent);
      } catch (error) {
        // A failing injected subscriber must not escape through emit into a write.
        // Timer/abort cleanup is already complete; future callbacks are inert.
        controller?.error(error);
      }
    }
  }
  function onAbort(): void {
    if (retired) return;
    controller?.close();
    cleanup();
  }
  function onEvent(event: BacklogEvent): void {
    if (retired) return;
    try {
      controller?.enqueue(encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(source.projectEvent(event))}\n\n`));
    } catch (error) {
      cleanup();
      controller?.error(error);
    }
  }
  function sendHeartbeat(): void {
    if (retired) return;
    controller?.enqueue(encoder.encode(': heartbeat\n\n'));
  }
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      if (source.signal.aborted) {
        cleanup();
        controller.close();
        return;
      }
      source.signal.addEventListener('abort', onAbort, { once: true });
      controller.enqueue(encoder.encode(': connected\n\n'));
      try {
        if (source.events !== undefined) {
          subscribed = true;
          source.events.subscribe(onEvent);
        }
        if (!retired) heartbeat = setInterval(sendHeartbeat, 30000);
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    cancel: cleanup,
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
