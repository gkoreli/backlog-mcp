/**
 * home-selector.ts — Which backlog home am I looking at? (ADR 0112.4)
 *
 * Primary role: the provenance badge. It renders what the SERVER resolved
 * (`HomeProvenance` off /api/status), not what the URL asked for — before
 * the Phase E cutover a `?home=project` URL may still resolve to the global
 * store, and the badge's whole job is that a human never mistakes global
 * work for project work (ADR 0112 R-9).
 *
 * Secondary role: switching. The active home lives in the URL and the app
 * is a pure function of it — the menu only rewrites the URL (via
 * AppState.setHomeSelection → history.pushState). HARD LAW (R-2/R-9): the
 * menu never asks the server what workspaces exist and never triggers a
 * disk scan; it offers exactly global (always) + the project the URL
 * already carries.
 */
import { signal, computed, component, html, effect, inject, when } from '@nisli/core';
import { AppState } from '../services/app-state.js';
import { buildApiUrl, homeDirName, type HomeProvenance } from '../utils/api.js';

export const HomeSelector = component('home-selector', () => {
  const app = inject(AppState);
  const provenance = signal<Partial<HomeProvenance> | undefined>(undefined);
  const open = signal(false);

  // Server truth, refreshed per home switch. Failure leaves the badge on
  // URL-derived fallback — never blocks the chrome.
  effect(() => {
    const selection = app.requestHomeSelection.value;
    void (async () => {
      try {
        const res = await fetch(buildApiUrl('/api/status', {}, selection));
        const status = await res.json() as Partial<HomeProvenance>;
        provenance.value = status.home ? status : undefined;
      } catch {
        provenance.value = undefined;
      }
    })();
  });

  const resolved = computed(() => {
    const p = provenance.value;
    if (p?.home === 'project') {
      return { kind: 'project', label: homeDirName(p.source_path ?? p.home_id ?? 'project') };
    }
    if (p?.home === 'global') return { kind: 'global', label: 'global' };
    // Fallback before /api/status answers (or legacy server): the URL's claim.
    const url = app.homeSelection.value;
    if (url?.home === 'project') return { kind: 'project', label: homeDirName(url.projectRoot) };
    return { kind: 'global', label: 'global' };
  });

  const icon = computed(() => resolved.value.kind === 'project' ? '📁' : '🌐');
  const label = computed(() => resolved.value.label);
  const title = computed(() => resolved.value.kind === 'project'
    ? `Project home: ${provenance.value?.source_path ?? app.projectRoot.value ?? ''}`
    : 'Global home (~/.backlog)');

  // Menu entries: global always; "this project" only when the URL already
  // carries a project_root (the bridge/CLI opened the viewer from a repo).
  const urlProjectRoot = computed(() => app.projectRoot.value);
  const hasUrlProject = computed(() => Boolean(urlProjectRoot.value));
  const globalActive = computed(() => resolved.value.kind === 'global' ? 'active' : '');
  const projectActive = computed(() => resolved.value.kind === 'project' ? 'active' : '');
  const projectLabel = computed(() => homeDirName(urlProjectRoot.value ?? ''));

  const toggleMenu = () => { open.value = !open.value; };
  const closeMenu = () => { open.value = false; };
  const pickGlobal = () => {
    app.setHomeSelection({ home: 'global' });
    closeMenu();
  };
  const pickProject = () => {
    const root = urlProjectRoot.value;
    if (root) app.setHomeSelection({ home: 'project', projectRoot: root });
    closeMenu();
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeMenu();
  };
  const menuDisplay = computed(() => open.value ? 'block' : 'none');
  const backdropDisplay = computed(() => open.value ? 'block' : 'none');

  return html`
    <div class="home-selector" @keydown=${onKeydown}>
      <button class="btn-outline home-badge" title="${title}" @click=${toggleMenu} aria-haspopup="menu">
        <span class="home-icon">${icon}</span>
        <span class="home-label">${label}</span>
      </button>
      <div class="home-menu-backdrop" style="display:${backdropDisplay}" @click=${closeMenu}></div>
      <div class="home-menu" role="menu" style="display:${menuDisplay}">
        <button class="home-menu-item ${globalActive}" role="menuitem" @click=${pickGlobal}>
          <span class="home-icon">🌐</span> global
        </button>
        ${when(hasUrlProject, html`
          <button class="home-menu-item ${projectActive}" role="menuitem" @click=${pickProject}>
            <span class="home-icon">📁</span> ${projectLabel}
          </button>
        `)}
      </div>
    </div>
    <style>
      .home-selector {
        position: relative;
        display: inline-flex;
      }
      .home-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 180px;
        border-radius: var(--t-radius-pill);
      }
      .home-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .home-menu-backdrop {
        position: fixed;
        inset: 0;
        z-index: 90;
      }
      .home-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 91;
        min-width: 180px;
        padding: 4px;
        background: var(--t-bg-elevated);
        border: 1px solid var(--t-border-default);
        border-radius: var(--t-radius-md);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      }
      .home-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 10px;
        border: none;
        background: transparent;
        color: var(--t-fg-default);
        border-radius: var(--t-radius-sm);
        cursor: pointer;
        text-align: left;
        font-size: 13px;
      }
      .home-menu-item:hover {
        background: var(--t-bg-hover, rgba(128, 128, 128, 0.15));
      }
      .home-menu-item.active {
        color: var(--t-accent-primary);
        font-weight: 600;
      }
    </style>
  `;
});
