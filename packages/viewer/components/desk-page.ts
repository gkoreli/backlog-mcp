/**
 * desk-page.ts — THE DESK (attention-viewer V1): a wakeup for the human.
 *
 * Read-only by law (PROMPT 0007): the server composes the briefing
 * (GET /api/desk) and this page renders it verbatim — ≤7 items above the
 * fold, worst-first across classes, why-it-surfaced on every item, honest
 * per-class omission, and one copy-ready agent instruction per item. The
 * page's only affordances are navigation and copy; verdicts flow back
 * through the agent, and items leave the Desk because the store changed.
 */
import {
  computed,
  component,
  each,
  html,
  inject,
  onCleanup,
  query,
  type ReadonlySignal,
} from '@nisli/core';
import { AppState } from '../services/app-state.js';
import { backlogEvents, type ChangeCallback } from '../services/event-source-client.js';
import { SplitPaneState } from '../services/split-pane-state.js';
import {
  fetchDesk,
  homeDirName,
  type DeskClass,
  type DeskItem,
} from '../utils/api.js';
import { CopyButton } from './copy-button.js';

/** The four questions, in the order the page answers them. */
const CLASS_ORDER: DeskClass[] = ['judge', 'review', 'read', 'health'];

const CLASS_LABEL: Record<DeskClass, string> = {
  judge: 'Judge',
  review: 'Review',
  read: 'Read',
  health: 'Health',
};

const CLASS_QUESTION: Record<DeskClass, string> = {
  judge: 'decisions only you can make',
  review: 'bounded verdicts on machine-surfaced candidates',
  read: 'the curated law delta',
  health: 'standing violations',
};

/** The existing MCP deep link for a document path. */
export function deskDocumentUri(path: string): string {
  return `mcp://backlog/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export const DeskPage = component('desk-page', () => {
  const app = inject(AppState);
  const splitState = inject(SplitPaneState);

  // Invalid URL selections stay visibly unavailable — never a silent
  // fallback to another home (same fail-closed rule as every queue).
  const invalidHomeSelection = computed(() =>
    app.requestHomeSelection.value !== undefined && app.homeSelection.value === undefined
  );
  const deskQuery = query(
    () => ['desk', app.requestHomeId.value],
    () => fetchDesk(app.requestHomeSelection.value),
    {
      enabled: () => !invalidHomeSelection.value,
      staleTime: 0,
    },
  );
  const briefing = computed(() => deskQuery.data.value);
  const error = computed(() => deskQuery.error.value?.message ?? null);

  const changeHandler: ChangeCallback = (event) => {
    if (
      app.view.value === 'desk'
      && (event.type === 'task_changed' || event.type === 'resource_changed')
    ) {
      deskQuery.refetch();
    }
  };
  backlogEvents.onChange(changeHandler);
  onCleanup(() => backlogEvents.offChange(changeHandler));

  const homeChip = computed(() => {
    const value = briefing.value;
    if (value?.home === 'project') return homeDirName(value.home_id ?? 'project');
    if (value?.home === 'global') return 'global';
    const selection = app.homeSelection.value;
    return selection?.home === 'project' ? homeDirName(selection.projectRoot) : 'global';
  });
  const worktreeChip = computed(() => briefing.value?.metadata.worktree ?? null);

  function openItem(item: DeskItem) {
    if (item.path !== undefined) {
      app.view.value = null;
      splitState.openMcpResource(deskDocumentUri(item.path), app.homeSelection.value);
      return;
    }
    if (item.class === 'review') {
      app.view.value = null;
      splitState.openCollisionCandidates(app.homeSelection.value);
      return;
    }
    app.view.value = null;
    app.selectTask(item.id);
  }

  function openMore(deskClass: DeskClass) {
    app.view.value = null;
    if (deskClass === 'review') {
      splitState.openCollisionCandidates(app.homeSelection.value);
      return;
    }
    app.isSpotlightOpen.value = true;
  }

  function renderItem(item: ReadonlySignal<DeskItem>) {
    const title = computed(() => item.value.title);
    const why = computed(() => item.value.why_surfaced);
    const instruction = computed(() => item.value.instruction);
    const age = computed(() =>
      item.value.age_days === undefined ? null : html`<span class="desk-age">${item.value.age_days}d</span>`
    );
    const agentChip = computed(() =>
      item.value.agent === undefined
        ? null
        : html`<span class="desk-chip desk-chip--agent">by ${item.value.agent}</span>`
    );
    const worktree = computed(() =>
      worktreeChip.value === null
        ? null
        : html`<span class="desk-chip desk-chip--worktree">${worktreeChip.value}</span>`
    );
    function handleOpen(event: Event) {
      event.preventDefault();
      openItem(item.value);
    }
    return html`
      <li class="desk-item">
        <div class="desk-item-head">
          <a href="#" class="desk-item-title" @click=${handleOpen}>${title}</a>
          ${age}
        </div>
        <p class="desk-why">${why}</p>
        <div class="desk-item-foot">
          <span class="desk-chips">
            <span class="desk-chip desk-chip--home">${homeChip}</span>
            ${agentChip}
            ${worktree}
          </span>
          <span class="desk-instruction" title=${instruction}>
            ${CopyButton({ text: instruction, content: html`<span>Copy instruction</span>` })}
          </span>
        </div>
      </li>
    `;
  }

  function renderSection(deskClass: DeskClass) {
    const items = computed(() =>
      (briefing.value?.items ?? []).filter((item) => item.class === deskClass)
    );
    const omittedCount = computed(() => briefing.value?.omitted[deskClass] ?? 0);
    const visible = computed(() => items.value.length > 0 || omittedCount.value > 0);
    const rows = each(items, (item) => item.id, renderItem);
    const omissionLine = computed(() => {
      const count = omittedCount.value;
      if (count === 0) return null;
      return html`
        <p class="desk-omitted">
          <a href="#" @click=${(event: Event) => { event.preventDefault(); openMore(deskClass); }}>
            ${count} more ${CLASS_LABEL[deskClass].toLowerCase()} item${count === 1 ? '' : 's'} not shown</a>
        </p>
      `;
    });
    return computed(() => {
      if (!visible.value) return null;
      return html`
        <section class="desk-section desk-section--${deskClass}">
          <h2 class="desk-section-title">
            ${CLASS_LABEL[deskClass]}
            <span class="desk-section-question">${CLASS_QUESTION[deskClass]}</span>
          </h2>
          <ol class="desk-item-list">${rows}</ol>
          ${omissionLine}
        </section>
      `;
    });
  }

  const [judgeSection, reviewSection, readSection, healthSection] =
    CLASS_ORDER.map(renderSection);

  const summary = computed(() => {
    const value = briefing.value;
    if (value === undefined) return null;
    const omittedTotal = CLASS_ORDER
      .reduce((total, deskClass) => total + (value.omitted[deskClass] ?? 0), 0);
    return html`<p class="desk-summary">
      ${value.items.length} of ≤${value.metadata.budget} above the fold, worst-first ·
      ${omittedTotal} more waiting below</p>`;
  });

  const diagnostics = computed(() => {
    const lines = briefing.value?.metadata.diagnostics ?? [];
    if (lines.length === 0) return null;
    return html`<p class="desk-diagnostics">${lines.join(' · ')}</p>`;
  });

  const content = computed(() => {
    if (invalidHomeSelection.value) {
      return html`<div class="desk-state">The Desk is unavailable because this home selection is invalid.</div>`;
    }
    if (deskQuery.loading.value && briefing.value === undefined) {
      return html`<div class="desk-state">Composing the Desk…</div>`;
    }
    if (error.value) {
      return html`<div class="desk-state desk-state--error">The Desk is unavailable: ${error}</div>`;
    }
    const value = briefing.value;
    if (value !== undefined && value.items.length === 0) {
      return html`<div class="desk-state desk-state--clear">The Desk is clear — nothing waits on your judgment.</div>`;
    }
    return html`${summary}${diagnostics}${judgeSection}${reviewSection}${readSection}${healthSection}`;
  });

  return html`
    <section class="desk-page" aria-label="The Desk — attention briefing">
      ${content}
    </section>
  `;
});
