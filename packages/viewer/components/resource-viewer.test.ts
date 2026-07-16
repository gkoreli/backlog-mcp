import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushEffects, provide, resetInjector } from '@nisli/core';
import { SplitPaneState } from '../services/split-pane-state.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      resolvePromise?.(value);
    },
  };
}

function resourceResponse(content: string, path: string): Response {
  return {
    ok: true,
    json: async () => ({
      content,
      path,
      ext: 'txt',
    }),
  } as Response;
}

let splitState: SplitPaneState;
let imported = false;

beforeEach(async () => {
  resetInjector();
  document.body.innerHTML = '';
  splitState = new SplitPaneState();
  provide(SplitPaneState, () => splitState);
  vi.stubGlobal('fetch', vi.fn());

  if (!imported) {
    await import('./resource-viewer.js');
    imported = true;
  }
});

describe('resource-viewer request generations', () => {
  it('does not render a stale response after switching resources', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const element = document.createElement('resource-viewer');
    document.body.appendChild(element);
    flushEffects();

    splitState.openResource('/first.txt', { home: 'global' });
    flushEffects();
    splitState.openResource('/second.txt', { home: 'global' });
    flushEffects();

    second.resolve(resourceResponse('second response', '/second.txt'));
    await vi.waitFor(() => {
      expect(element.textContent).toContain('second response');
    });

    first.resolve(resourceResponse('stale first response', '/first.txt'));
    await Promise.resolve();
    await Promise.resolve();
    flushEffects();

    expect(element.textContent).toContain('second response');
    expect(element.textContent).not.toContain('stale first response');
  });
});
