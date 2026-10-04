import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventStreamResponse } from '../server/event-stream.js';
import { Hono } from 'hono';
import { registerEventRoutes } from '../server/event-routes.js';
import type { AppRequestRuntime } from '../composition/app-request-runtime.types.js';
import type { IBacklogService } from '../core/backlog-service.contract.js';
import { LocalEventBus } from '../events/local-event-bus.js';

const event = { type: 'task_changed' as const, id: 'TASK-0001', tool: 'backlog_update', actor: 'test', ts: '2026-10-04T00:00:00Z' };
function reader(response: Response) {
  if (response.body === null) throw new Error('Missing event stream');
  return response.body.getReader();
}
afterEach(function restore() { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('request-owned event streams', function streams() {
  it('keeps same-ID notifications and provenance local to the selected home', async function selectedHomes() {
    vi.useFakeTimers();
    const buses = [new LocalEventBus(), new LocalEventBus()];
    const releases = buses.map(bus => vi.spyOn(bus, 'unsubscribe'));
    const app = new Hono();
    registerEventRoutes(app, async function select(request): Promise<AppRequestRuntime> {
      const index = request.header('x-home') === 'second' ? 1 : 0;
      const root = `/selected-${index}`;
      return { service: {} as IBacklogService, eventBus: buses[index], intentRegistrationMode: 'unavailable', home: { kind: 'project', root, id: root, documentsDir: `${root}/docs`, controlDir: `${root}/.backlog` }, getSourcePath: () => `${root}/docs/task.md` };
    });
    const first = reader(await app.request('/events', { headers: { 'x-home': 'first' } }));
    const second = reader(await app.request('/events', { headers: { 'x-home': 'second' } }));
    await first.read(); await second.read();
    buses[0].emit(event); buses[1].emit(event);
    const decode = new TextDecoder();
    expect(decode.decode((await first.read()).value)).toContain('/selected-0');
    expect(decode.decode((await second.read()).value)).toContain('/selected-1');
    await first.cancel();
    expect(releases[0]).toHaveBeenCalledOnce();
    expect(releases[1]).not.toHaveBeenCalled();
    buses[1].emit(event);
    expect(decode.decode((await second.read()).value)).toContain('id: 2');
    await second.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves frames and immediately retires cancellation before a later abort', async function cancellation() {
    vi.useFakeTimers();
    const bus = new LocalEventBus();
    const unsubscribe = vi.spyOn(bus, 'unsubscribe');
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const stream = reader(createEventStreamResponse({ events: bus, signal: abort.signal, projectEvent: e => ({ ...e, home: 'selected' }) }));
    const decode = new TextDecoder();
    expect(decode.decode((await stream.read()).value)).toBe(': connected\n\n');
    bus.emit(event);
    expect(decode.decode((await stream.read()).value)).toContain('id: 1\ndata: {');
    vi.advanceTimersByTime(30000);
    expect(decode.decode((await stream.read()).value)).toBe(': heartbeat\n\n');
    await stream.cancel();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    abort.abort();
    bus.emit(event);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it.each([true, false])('closes aborted streams with bus=%s and releases their timer', async function aborted(withBus) {
    vi.useFakeTimers();
    const abort = new AbortController();
    const bus = new LocalEventBus();
    const unsubscribe = vi.spyOn(bus, 'unsubscribe');
    const stream = reader(createEventStreamResponse({ events: withBus ? bus : undefined, signal: abort.signal, projectEvent: e => e }));
    await stream.read();
    abort.abort();
    expect(await stream.read()).toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
    expect(unsubscribe).toHaveBeenCalledTimes(withBus ? 1 : 0);
  });

  it('does not admit effects for an already aborted request and cancels heartbeat-only bodies', async function noBus() {
    vi.useFakeTimers();
    const abort = new AbortController();
    abort.abort();
    const bus = new LocalEventBus();
    const subscribe = vi.spyOn(bus, 'subscribe');
    const ended = reader(createEventStreamResponse({ events: bus, signal: abort.signal, projectEvent: e => e }));
    expect((await ended.read()).done).toBe(true);
    expect(subscribe).not.toHaveBeenCalled();
    const stream = reader(createEventStreamResponse({ signal: new AbortController().signal, projectEvent: e => e }));
    await stream.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['projection', 'serialization', 'unsubscribe'])('isolates %s failure from semantic emit and retires callbacks', async function failure(kind) {
    vi.useFakeTimers();
    const bus = new LocalEventBus();
    const unsubscribe = vi.spyOn(bus, 'unsubscribe');
    if (kind === 'unsubscribe') unsubscribe.mockImplementation(function fail() { throw new Error('release failed'); });
    const circular: Record<string, unknown> = {}; circular.self = circular;
    const project = vi.fn(function project() {
      if (kind !== 'serialization') throw new Error('projection failed');
      return circular;
    });
    const stream = reader(createEventStreamResponse({ events: bus, signal: new AbortController().signal, projectEvent: project }));
    await stream.read();
    expect(() => bus.emit(event)).not.toThrow();
    await expect(stream.read()).rejects.toThrow();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => bus.emit(event)).not.toThrow();
    expect(project).toHaveBeenCalledOnce();
  });

  it('retires partially admitted subscriptions when setup fails', async function setupFailure() {
    vi.useFakeTimers();
    const bus = new LocalEventBus();
    vi.spyOn(bus, 'subscribe').mockImplementation(function fail() { throw new Error('subscribe failed'); });
    const release = vi.spyOn(bus, 'unsubscribe');
    const stream = reader(createEventStreamResponse({ events: bus, signal: new AbortController().signal, projectEvent: e => e }));
    await expect(stream.read()).rejects.toThrow('subscribe failed');
    expect(release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
