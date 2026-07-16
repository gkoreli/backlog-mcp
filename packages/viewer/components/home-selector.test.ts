/**
 * home-selector.test.ts — provenance badge + URL-switch menu (ADR 0112.4).
 *
 * The badge shows the SERVER-resolved home (from /api/status provenance),
 * falling back to the URL claim; the menu offers exactly global + the URL's
 * project (never a server workspace listing) and switching only rewrites
 * the URL via AppState.setHomeSelection.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushEffects, resetInjector, provide } from '@nisli/core';
import { AppState } from '../services/app-state.js';
import { homeDirName } from '../utils/api.js';

let app: AppState;
let imported = false;
let statusPayload: Record<string, unknown>;

async function settle(): Promise<void> {
  flushEffects();
  // Let the /api/status fetch effect resolve, then re-render.
  await Promise.resolve();
  await Promise.resolve();
  flushEffects();
}

beforeEach(async () => {
  resetInjector();
  document.body.innerHTML = '';
  // AppState reads the URL at construction — clear prior tests' pushState.
  history.replaceState(null, '', '/');
  statusPayload = {};
  vi.stubGlobal('fetch', vi.fn(async () => ({
    json: async () => statusPayload,
  })));

  app = new AppState();
  provide(AppState, () => app);

  if (!imported) {
    await import('./home-selector.js');
    imported = true;
  }
});

function mount(): HTMLElement {
  const el = document.createElement('home-selector');
  document.body.appendChild(el);
  flushEffects();
  return el;
}

describe('homeDirName', () => {
  it('takes the last path segment', () => {
    expect(homeDirName('/Users/goga/backlog-mcp')).toBe('backlog-mcp');
    expect(homeDirName('/Users/goga/backlog-mcp/')).toBe('backlog-mcp');
    expect(homeDirName('global')).toBe('global');
  });
});

describe('home-selector', () => {
  it('renders the server-resolved provenance: global', async () => {
    statusPayload = { home: 'global', home_id: 'global' };
    const el = mount();
    await settle();
    expect(el.querySelector('.home-label')?.textContent).toBe('global');
    expect(el.querySelector('.home-icon')?.textContent).toBe('🌐');
  });

  it('renders the project dir name from server provenance', async () => {
    statusPayload = { home: 'project', home_id: '/x/y/acme-app', source_path: '/x/y/acme-app' };
    const el = mount();
    await settle();
    expect(el.querySelector('.home-label')?.textContent).toBe('acme-app');
    expect(el.querySelector('.home-icon')?.textContent).toBe('📁');
  });

  it('shows the SERVER truth even when the URL claims a project (pre-Phase-E honesty)', async () => {
    app.setHomeSelection({ home: 'project', projectRoot: '/x/y/acme-app' });
    statusPayload = { home: 'global', home_id: 'global' };  // server resolved global anyway
    const el = mount();
    await settle();
    expect(el.querySelector('.home-label')?.textContent).toBe('global');
  });

  it('menu offers global always, project only when the URL carries a project_root', async () => {
    statusPayload = { home: 'global', home_id: 'global' };
    const el = mount();
    await settle();
    (el.querySelector('.home-badge') as HTMLElement).click();
    flushEffects();
    let items = [...el.querySelectorAll('.home-menu-item')].map(i => i.textContent?.trim());
    expect(items.some(t => t?.includes('global'))).toBe(true);
    expect(items).toHaveLength(1);

    app.setHomeSelection({ home: 'project', projectRoot: '/x/y/acme-app' });
    await settle();
    items = [...el.querySelectorAll('.home-menu-item')].map(i => i.textContent?.trim());
    expect(items).toHaveLength(2);
    expect(items.some(t => t?.includes('acme-app'))).toBe(true);
  });

  it('switching rewrites the URL selection only — global pick clears the project root', async () => {
    app.setHomeSelection({ home: 'project', projectRoot: '/x/y/acme-app' });
    statusPayload = { home: 'project', home_id: '/x/y/acme-app', source_path: '/x/y/acme-app' };
    const el = mount();
    await settle();
    (el.querySelector('.home-badge') as HTMLElement).click();
    flushEffects();
    const globalItem = [...el.querySelectorAll('.home-menu-item')]
      .find(i => i.textContent?.includes('global')) as HTMLElement;
    globalItem.click();
    flushEffects();
    expect(app.home.value).toBe('global');
    expect(app.projectRoot.value).toBeNull();
  });
});
