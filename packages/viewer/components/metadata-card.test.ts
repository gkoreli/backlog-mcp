import { beforeEach, describe, expect, it } from 'vitest';
import { flushEffects, provide, resetInjector } from '@nisli/core';
import { SplitPaneState } from '../services/split-pane-state.js';
import { formatCollisionSignals } from './metadata-card.js';

beforeEach(() => {
  resetInjector();
  document.body.innerHTML = '';
  provide(SplitPaneState, () => new SplitPaneState());
});

describe('collision candidate metadata', () => {
  it('renders detail objects as candidate links with digest and priority', () => {
    const element = document.createElement('metadata-card');
    (element as any)._setProp('entries', [{
        key: 'collision candidates',
        value: [{
          id: 'MEMO-0002',
          title: 'Other deployment target',
          digest: 'Production deploys to a local VPS.',
          pair_priority: 0.8125,
          signals: { neighbor_rank: 1, lexical_overlap: 0.5, scope: 1, epistemic_shape: 1 },
        }],
      }]);
    (element as any)._setProp('homeSelection', { home: 'global' });
    document.body.appendChild(element);
    flushEffects();

    expect(element.textContent).toContain('1 collision candidate');
    expect(element.textContent).toContain('Production deploys to a local VPS.');
    expect(element.textContent).toContain('priority 0.813');
    expect(element.textContent).not.toContain('[object Object]');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('mcp://backlog/tasks/MEMO-0002.md');
  });

  it('formats bounded collision signals without raw search scores', () => {
    expect(formatCollisionSignals({
      neighbor_rank: 1,
      lexical_overlap: 0.5,
      scope: 0.8,
      epistemic_shape: 1,
    })).toBe('neighbor rank 1.00 · lexical overlap 0.50 · scope 0.80 · epistemic shape 1.00');
  });
});
