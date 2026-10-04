/** Spotlight renders server snippets for open substrate types. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushEffects, provide, resetInjector } from '@nisli/core';
import { AppState } from '../services/app-state.js';
import { SplitPaneState } from '../services/split-pane-state.js';
import './spotlight-search.js';

afterEach(function cleanUp() {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Spotlight server snippet', function describeSpotlight() {
  it('renders the custom match safely through the actual component', async function rendersCustomSnippet() {
    resetInjector();
    localStorage.clear();
    vi.useFakeTimers();
    const app = new AppState();
    provide(AppState, function appState() { return app; });
    provide(SplitPaneState, function paneState() { return new SplitPaneState(); });
    vi.stubGlobal('fetch', vi.fn(async function fetchResult(url: string) {
      return { ok: true, json: async function result() {
        return url.includes('/search?') ? [{ item: { id: 'NOTE-0001', title: '<img src=x> Custom note' }, type: 'note', score: 1, snippet: { field: 'decision_basis', text: '<img src=x> needle', matched_fields: ['decision_basis'] } }] : [];
      } };
    }));
    app.isSpotlightOpen.value = true;
    const element = document.createElement('spotlight-search');
    document.body.append(element);
    flushEffects();
    const input = element.querySelector('input');
    if (input === null) throw new Error('Missing search input');
    input.value = 'needle';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(301);
    flushEffects();
    expect(element.querySelector('.snippet-text')?.textContent).toBe('<img src=x> needle');
    expect(element.querySelector('.spotlight-result-field')?.textContent).toContain('decision_basis');
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('.snippet-text mark')?.textContent).toBe('needle');
  });
});
