/**
 * system-info-modal.ts — Reactive modal for displaying server system information.
 *
 * Reads AppState.isSystemInfoOpen to show/hide. Fetches system info via query()
 * on open. Uses CopyButton factory composition for the data directory copy action.
 *
 * Release awareness + self-restart (ADR 0131): a second query asks the daemon
 * whether the install on disk is newer than the process serving it; the
 * button asks the daemon to hand over to a fresh process and waits for it to
 * answer before reloading the page.
 *
 * See ADR 0007 (shared services) for the open/close signal pattern.
 */
import { computed, component, html, inject, query, onMount, signal } from '@nisli/core';
import { AppState } from '../services/app-state.js';
import { CopyButton } from './copy-button.js';
import { buildApiUrl } from '../utils/api.js';
import {
  fetchRelease,
  restartServer,
  type ReleaseInfo,
} from '../services/server-restart.js';

interface SystemInfo {
  version: string;
  port: number;
  dataDir: string;
  taskCount: number;
  uptime: number;
}

type RestartPhase =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'failed'; error: string };

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function describeInstalled(release: ReleaseInfo | undefined): string {
  if (release === undefined) return '';
  if (release.installed === null) return 'unknown';
  if (release.updateAvailable) return `${release.installed} — newer than the running server`;
  return `${release.installed} (running the current install)`;
}

export const SystemInfoModal = component('system-info-modal', (_props, _host) => {
  const app = inject(AppState);

  // ── Data loading — only fetches when modal is open ──────────────
  const infoQuery = query<SystemInfo>(
    () => ['system-info', app.requestHomeId.value, app.isSystemInfoOpen.value],
    () => fetch(buildApiUrl(
      '/api/status',
      {},
      app.requestHomeSelection.value,
    )).then(r => r.json()),
    {
      enabled: () => app.isSystemInfoOpen.value,
      staleTime: 0, // always refetch on open
    },
  );
  const releaseQuery = query<ReleaseInfo>(
    () => ['release', app.isSystemInfoOpen.value],
    () => fetchRelease(app.requestHomeSelection.value),
    {
      enabled: () => app.isSystemInfoOpen.value,
      staleTime: 0,
    },
  );

  const info = infoQuery.data;
  const loading = infoQuery.loading;
  const error = computed(() => infoQuery.error.value?.message ?? null);
  const release = releaseQuery.data;
  const restartPhase = signal<RestartPhase>({ kind: 'idle' });

  // ── Actions ────────────────────────────────────────────────────
  function close() {
    app.isSystemInfoOpen.value = false;
  }

  function handleOverlayClick(e: Event) {
    if (e.target === (e.currentTarget as HTMLElement)) close();
  }

  async function runRestart() {
    const current = release.value;
    if (current === undefined) return;
    restartPhase.value = { kind: 'working' };
    const outcome = await restartServer(current);
    if (outcome.ok) {
      // New daemon, possibly new viewer assets: start over from the server.
      location.reload();
      return;
    }
    restartPhase.value = { kind: 'failed', error: outcome.error };
  }

  function onRestartClick() {
    void runRestart();
  }

  // ── Keyboard: Escape to close ──────────────────────────────────
  onMount(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (app.isSystemInfoOpen.value && e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });

  // ── Derived state (flat — no nested computed in templates) ─────
  const version = computed(() => info.value?.version ?? '');
  const port = computed(() => String(info.value?.port ?? ''));
  const dataDir = computed(() => info.value?.dataDir ?? '');
  const taskCount = computed(() => String(info.value?.taskCount ?? ''));
  const uptime = computed(() => info.value ? formatUptime(info.value.uptime) : '');
  const overlayDisplay = computed(() => app.isSystemInfoOpen.value ? 'flex' : 'none');
  const installedText = computed(() => releaseQuery.loading.value && !release.value ? 'checking…' : describeInstalled(release.value));
  const restartLabel = computed(() => {
    if (restartPhase.value.kind === 'working') return 'Restarting…';
    const current = release.value;
    return current?.updateAvailable && current.installed !== null
      ? `Restart to ${current.installed}`
      : 'Restart server';
  });
  const restartDisabled = computed(() => restartPhase.value.kind === 'working' || release.value?.canRestart !== true);
  const restartDisplay = computed(() => release.value?.canRestart ? 'inline-flex' : 'none');
  const restartError = computed(() => restartPhase.value.kind === 'failed' ? restartPhase.value.error : '');
  const errorDisplay = computed(() => restartError.value ? 'block' : 'none');

  const copyDirBtn = CopyButton({ text: dataDir, content: html`Copy` });

  // ── Body: 3-way branch via computed view (tmpl-computed-views) ─
  const infoGridView = html`
    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Version</span>
        <span class="info-value">${version}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Installed</span>
        <span class="info-value">${installedText}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Port</span>
        <span class="info-value">${port}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Data Directory</span>
        <span class="info-value">
          <code>${dataDir}</code>
          ${copyDirBtn}
        </span>
      </div>
      <div class="info-row">
        <span class="info-label">Task Count</span>
        <span class="info-value">${taskCount}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Uptime</span>
        <span class="info-value">${uptime}</span>
      </div>
    </div>
    <div class="release-actions">
      <button class="btn-outline release-restart" style="${computed(() => `display:${restartDisplay.value}`)}" disabled="${restartDisabled}" @click="${onRestartClick}">${restartLabel}</button>
      <div class="error release-error" style="${computed(() => `display:${errorDisplay.value}`)}">${restartError}</div>
    </div>
  `;

  const bodyContent = computed(() => {
    if (error.value) return html`<div class="error">Failed to load system info</div>`;
    if (loading.value && !info.value) return html`<div class="loading">Loading...</div>`;
    return infoGridView;
  });

  // ── Template ───────────────────────────────────────────────────
  return html`
    <div class="modal-overlay" style="${computed(() => `display:${overlayDisplay.value}`)}" @click="${handleOverlayClick}">
      <div class="modal-content">
        <div class="modal-header">
          <h2>System Information</h2>
          <button class="modal-close" @click="${close}">&times;</button>
        </div>
        <div class="modal-body">
          ${bodyContent}
        </div>
      </div>
    </div>
  `;
});
