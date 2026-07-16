/**
 * md-block.test.ts — Async markdown resource integration.
 *
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushEffects, tick } from '@nisli/core';

const mocks = vi.hoisted(() => {
  let releaseImport = (): void => {};
  let importGate = Promise.resolve();
  let importStarted = false;

  return {
    parse: vi.fn(),
    mermaidInitialize: vi.fn(),
    mermaidRun: vi.fn(async () => {}),
    holdMermaidImport(): void {
      importStarted = false;
      importGate = new Promise<void>((resolve) => {
        releaseImport = resolve;
      });
    },
    releaseMermaidImport(): void {
      releaseImport();
    },
    isMermaidImportStarted(): boolean {
      return importStarted;
    },
    async waitForMermaidImport(): Promise<void> {
      importStarted = true;
      await importGate;
    },
  };
});

vi.mock('../markdown/index.js', () => ({
  marked: { parse: mocks.parse },
}));

vi.mock('mermaid', async () => {
  await mocks.waitForMermaidImport();
  return {
    default: {
      initialize: mocks.mermaidInitialize,
      run: mocks.mermaidRun,
    },
  };
});

import './md-block.js';

type MdBlockElement = HTMLElement & {
  _setProp(name: string, value: unknown): void;
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise = (_value: T): void => {
    throw new Error('Deferred promise was not initialized');
  };
  const promise = new Promise<T>((res) => {
    resolvePromise = res;
  });
  return { promise, resolve: resolvePromise };
}

function mountMdBlock(content: string): MdBlockElement {
  const element = document.createElement('md-block') as MdBlockElement;
  element._setProp('content', content);
  document.body.appendChild(element);
  flushEffects();
  return element;
}

function setContent(element: MdBlockElement, content: string): void {
  element._setProp('content', content);
  flushEffects();
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('MdBlock', () => {
  it('does not run stale Mermaid work while replacement parsing is pending', async () => {
    const replacementParse = deferred<string>();
    mocks.holdMermaidImport();
    mocks.parse.mockImplementation((markdown: string) => {
      if (markdown === 'replacement') return replacementParse.promise;
      return Promise.resolve('<pre class="mermaid">graph TD; A--&gt;B;</pre>');
    });

    const element = mountMdBlock('diagram');
    await vi.waitFor(() => {
      expect(element.querySelector('pre.mermaid')).not.toBeNull();
      expect(mocks.isMermaidImportStarted()).toBe(true);
    });

    setContent(element, 'replacement');
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledWith('replacement'));

    mocks.releaseMermaidImport();
    await tick();
    expect(mocks.mermaidRun).not.toHaveBeenCalled();

    replacementParse.resolve('<p>replacement</p>');
  });

  it('renders async markdown and runs Mermaid after the HTML binding updates', async () => {
    mocks.parse.mockResolvedValue(`
      <h1>Rendered</h1>
      <pre class="shiki"><code>const value = 1;</code></pre>
      <pre class="mermaid">graph TD; A--&gt;B;</pre>
    `);

    const element = mountMdBlock('# Source');
    const body = element.querySelector('.markdown-body');

    await vi.waitFor(() => {
      expect(body?.querySelector('h1')?.textContent).toBe('Rendered');
      expect(body?.querySelector('pre.shiki')).not.toBeNull();
      expect(mocks.mermaidRun).toHaveBeenCalledTimes(1);
    });

    const options = mocks.mermaidRun.mock.calls[0]?.[0];
    expect(options?.nodes).toHaveLength(1);
  });

  it('does not let an older parse overwrite newer content', async () => {
    const oldParse = deferred<string>();
    const newParse = deferred<string>();
    mocks.parse.mockImplementation((markdown: string) => (
      markdown === 'old' ? oldParse.promise : newParse.promise
    ));

    const element = mountMdBlock('old');
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledWith('old'));

    setContent(element, 'new');
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledWith('new'));

    newParse.resolve('<p>new result</p>');
    await vi.waitFor(() => {
      expect(element.querySelector('.markdown-body')?.textContent).toBe('new result');
    });

    oldParse.resolve('<p>old result</p>');
    await Promise.resolve();
    flushEffects();
    expect(element.querySelector('.markdown-body')?.textContent).toBe('new result');
  });

  it('disables parsing and clears rendered HTML for empty content', async () => {
    mocks.parse.mockResolvedValue('<p>rendered</p>');
    const element = mountMdBlock('content');

    await vi.waitFor(() => {
      expect(element.querySelector('.markdown-body')?.textContent).toBe('rendered');
    });

    setContent(element, '');
    await vi.waitFor(() => {
      expect(element.querySelector('.markdown-body')?.innerHTML).toBe('');
    });
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });
});
