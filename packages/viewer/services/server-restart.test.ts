import { describe, expect, it, vi } from 'vitest';
import { restartServer } from './server-restart.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const sleep = vi.fn(async () => {});
const fast = { sleep, pollMs: 1, timeoutMs: 10 };

describe('restartServer (ADR 0131 R4)', () => {
  it('posts the restart, then waits until a daemon answers /version again', async () => {
    const versions: Array<string | null> = [null, null, '0.73.0'];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ status: 'restarting' }, 202);
      const next = versions.shift() ?? '0.73.0';
      return next === null ? new Response('', { status: 503 }) : jsonResponse(next);
    });

    const outcome = await restartServer({ running: '0.73.0', installed: '0.73.0', updateAvailable: false }, { ...fast, fetchFn: fetchFn as unknown as typeof fetch });
    expect(outcome).toEqual({ ok: true, version: '0.73.0' });
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('when the disk install is newer, keeps waiting until that version answers', async () => {
    const versions = ['0.73.0', '0.73.0', '0.74.0'];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ status: 'restarting' }, 202) : jsonResponse(versions.shift() ?? '0.74.0'));

    const outcome = await restartServer({ running: '0.73.0', installed: '0.74.0', updateAvailable: true }, { ...fast, fetchFn: fetchFn as unknown as typeof fetch });
    expect(outcome).toEqual({ ok: true, version: '0.74.0' });
  });

  it('surfaces a refused request without polling', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'Forbidden: restart is a same-machine action' }, 403));
    const outcome = await restartServer({ running: '0.73.0', installed: '0.73.0', updateAvailable: false }, { ...fast, fetchFn: fetchFn as unknown as typeof fetch });
    expect(outcome).toEqual({ ok: false, error: 'Forbidden: restart is a same-machine action' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('times out honestly, naming the log to check', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({ status: 'restarting' }, 202) : new Response('', { status: 503 }));
    const outcome = await restartServer({ running: '0.73.0', installed: '0.73.0', updateAvailable: false }, { ...fast, timeoutMs: 3, fetchFn: fetchFn as unknown as typeof fetch });
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('server.log') });
  });
});
