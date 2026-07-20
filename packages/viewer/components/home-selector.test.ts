/**
 * home-selector.test.ts — provenance badge + recent-homes switch menu
 * (ADR 0112.4 + ADR 0128).
 *
 * The badge and menu render SERVER-computed strings verbatim: `label` and
 * `display_path` come from /api/status provenance and /api/homes — the client
 * does no path surgery. The menu lists global + every project home from the
 * use-declared recent-homes manifest (never a filesystem scan). Switching only
 * rewrites the URL via AppState.setHomeSelection.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushEffects, resetInjector, provide } from '@nisli/core';
import { AppState } from '../services/app-state.js';
import { type RecentHome } from '../utils/api.js';

let app: AppState;
let imported = false;
let statusPayload: Record<string, unknown>;
let homesPayload: { homes: RecentHome[] };

/** A server-presented global entry (label + display_path already computed). */
function globalEntry(display = '~/.backlog'): RecentHome {
  return { home: 'global', label: 'global', root: '/Users/x/.backlog', display_path: display };
}

/** A server-presented project entry — label/display_path as the server sends them. */
function projectEntry(root: string, label: string, lastSeen: string): RecentHome {
  return {
    home: 'project',
    root,
    label,
    display_path: root.replace('/Users/x', '~'),
    first_seen: 'a',
    last_seen: lastSeen,
  };
}

/** Server /api/status provenance for a project (label/display_path presented). */
function projectStatus(root: string, label: string): Record<string, unknown> {
  return {
    home: 'project',
    home_id: root,
    root,
    label,
    display_path: root.replace('/Users/x', '~'),
    source_path: root,
  };
}

const globalStatus = { home: 'global', home_id: 'global', root: '/Users/x/.backlog', label: 'global', display_path: '~/.backlog' };

async function settle(): Promise<void> {
  flushEffects();
  // Let the /api/status + /api/homes fetch effects resolve, then re-render.
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
  homesPayload = { homes: [globalEntry()] };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.includes('/api/homes') ? homesPayload : statusPayload),
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

describe('home-selector', () => {
  it('renders the server-presented label: global', async () => {
    statusPayload = globalStatus;
    const el = mount();
    await settle();
    expect(el.querySelector('.home-label')?.textContent).toBe('global');
    expect(el.querySelector('.home-icon')?.textContent).toBe('🌐');
  });

  it('renders the project label straight from server provenance (no client parsing)', async () => {
    statusPayload = projectStatus('/x/y/acme-app', 'acme-app');
    const el = mount();
    await settle();
    expect(el.querySelector('.home-label')?.textContent).toBe('acme-app');
    expect(el.querySelector('.home-icon')?.textContent).toBe('📁');
  });

  it('shows the SERVER truth even when the URL claims a project (pre-Phase-E honesty)', async () => {
    app.setHomeSelection({ home: 'project', projectRoot: '/x/y/acme-app' });
    statusPayload = globalStatus;  // server resolved global anyway
    const el = mount();
    await settle();
    expect(el.querySelector('.home-label')?.textContent).toBe('global');
  });

  it('menu offers only global when the manifest is empty and the URL has no project', async () => {
    statusPayload = globalStatus;
    const el = mount();
    await settle();
    (el.querySelector('.home-badge') as HTMLElement).click();
    flushEffects();
    const items = [...el.querySelectorAll('.home-menu-item')].map(i => i.textContent?.trim());
    expect(items).toHaveLength(1);
    expect(items.some(t => t?.includes('global'))).toBe(true);
  });

  it('lists every recent project from the manifest — no URL project needed (ADR 0128)', async () => {
    statusPayload = globalStatus;
    homesPayload = {
      homes: [
        globalEntry(),
        projectEntry('/Users/x/acme-app', 'acme-app', 'b'),
        projectEntry('/Users/x/beta-svc', 'beta-svc', 'c'),
      ],
    };
    const el = mount();
    await settle();
    (el.querySelector('.home-badge') as HTMLElement).click();
    flushEffects();
    const items = [...el.querySelectorAll('.home-menu-item')].map(i => i.textContent?.trim());
    expect(items).toHaveLength(3); // global + 2 recent projects
    expect(items.some(t => t?.includes('acme-app'))).toBe(true);
    expect(items.some(t => t?.includes('beta-svc'))).toBe(true);
  });

  it('renders the server display_path verbatim (no client ~ collapsing)', async () => {
    statusPayload = globalStatus;
    homesPayload = {
      homes: [globalEntry(), projectEntry('/Users/x/acme-app', 'acme-app', 'b')],
    };
    const el = mount();
    await settle();
    (el.querySelector('.home-badge') as HTMLElement).click();
    flushEffects();
    const paths = [...el.querySelectorAll('.home-item-path')].map(i => i.textContent?.trim());
    // Exactly what the server sent — projectEntry() presents /Users/x → ~.
    expect(paths).toContain('~/acme-app');
    expect(paths).toContain('~/.backlog');
  });

  it('pins the URL-carried project once the server presents it', async () => {
    statusPayload = projectStatus('/Users/x/fresh-repo', 'fresh-repo');
    const el = mount();
    await settle();
    app.setHomeSelection({ home: 'project', projectRoot: '/Users/x/fresh-repo' });
    await settle();
    (el.querySelector('.home-badge') as HTMLElement).click();
    flushEffects();
    const items = [...el.querySelectorAll('.home-menu-item')].map(i => i.textContent?.trim());
    expect(items.some(t => t?.includes('fresh-repo'))).toBe(true);
  });

  it('preserves the manifest recency order (most-recent-first, not alphabetical)', async () => {
    statusPayload = globalStatus;
    // Manifest arrives most-recent-first: zzz-newest before aaa-oldest.
    homesPayload = {
      homes: [
        globalEntry(),
        projectEntry('/Users/x/zzz-newest', 'zzz-newest', 'z'),
        projectEntry('/Users/x/aaa-oldest', 'aaa-oldest', 'b'),
      ],
    };
    const el = mount();
    await settle();
    (el.querySelector('.home-badge') as HTMLElement).click();
    flushEffects();
    const labels = [...el.querySelectorAll('.home-item-label')]
      .map(i => i.textContent?.trim());
    // global, then zzz-newest (recent), then aaa-oldest — NOT alphabetized.
    expect(labels).toEqual(['global', 'zzz-newest', 'aaa-oldest']);
  });

  it('shows an empty-state hint when no projects are known', async () => {
    statusPayload = globalStatus;
    const el = mount();
    await settle();
    (el.querySelector('.home-badge') as HTMLElement).click();
    flushEffects();
    expect(el.querySelector('.home-menu-empty')).not.toBeNull();
    expect(el.querySelectorAll('.home-menu-item--project')).toHaveLength(0);
  });

  it('forget removes a project via DELETE and refreshes the list (R6)', async () => {
    statusPayload = globalStatus;
    homesPayload = {
      homes: [globalEntry(), projectEntry('/Users/x/acme-app', 'acme-app', 'b')],
    };
    let deleteCalledWith: string | undefined;
    // Re-stub fetch to observe the DELETE and drop the entry afterward.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        deleteCalledWith = url;
        homesPayload = { homes: [globalEntry()] };
        return { ok: true, json: async () => ({ removed: true }) };
      }
      return {
        ok: true,
        json: async () => (url.includes('/api/homes') ? homesPayload : statusPayload),
      };
    }));

    const el = mount();
    await settle();
    (el.querySelector('.home-badge') as HTMLElement).click();
    flushEffects();
    expect(el.querySelectorAll('.home-menu-item--project')).toHaveLength(1);

    (el.querySelector('.home-forget') as HTMLElement).click();
    // forget awaits DELETE then re-fetches homes — give both microtasks room.
    await settle();
    await settle();
    expect(deleteCalledWith).toContain(encodeURIComponent('/Users/x/acme-app'));
    expect(el.querySelectorAll('.home-menu-item--project')).toHaveLength(0);
  });

  it('switching rewrites the URL selection only — global pick clears the project root', async () => {
    app.setHomeSelection({ home: 'project', projectRoot: '/x/y/acme-app' });
    statusPayload = projectStatus('/x/y/acme-app', 'acme-app');
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
