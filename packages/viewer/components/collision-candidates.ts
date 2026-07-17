/**
 * collision-candidates.ts — Read-only, server-authoritative review queue.
 *
 * The server supplies the total order. This component deliberately renders
 * `pairs` as received: collision candidates are adjudication pressure, not a
 * client-side ranking surface.
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
  fetchCollisionCandidates,
  type CollisionCandidateMember,
  type CollisionCandidatePair,
} from '../utils/api.js';
import { formatCollisionSignals } from './metadata-card.js';

/** Construct the existing MCP deep link for one memory. */
export function collisionCandidateUri(id: string): string {
  return `mcp://backlog/tasks/${encodeURIComponent(id)}.md`;
}

export const CollisionCandidates = component('collision-candidates', () => {
  const app = inject(AppState);
  const splitState = inject(SplitPaneState);

  // Invalid URL selections must never fall back to the legacy home. They stay
  // visible as unavailable, and the exact malformed identity still keys state.
  const invalidHomeSelection = computed(() =>
    app.requestHomeSelection.value !== undefined && app.homeSelection.value === undefined
  );
  const candidatesQuery = query(
    () => ['collision-candidates', app.requestHomeId.value],
    () => fetchCollisionCandidates(app.requestHomeSelection.value),
    {
      enabled: () => !invalidHomeSelection.value,
      staleTime: 0,
    },
  );
  const pairs = computed(() => candidatesQuery.data.value?.pairs ?? []);
  const summary = computed(() => candidatesQuery.data.value);
  const error = computed(() => candidatesQuery.error.value?.message ?? null);

  const changeHandler: ChangeCallback = (event) => {
    if (
      splitState.activePane.value === 'collision-candidates'
      && (event.type === 'task_changed' || event.type === 'resource_changed')
    ) {
      candidatesQuery.refetch();
    }
  };
  backlogEvents.onChange(changeHandler);
  onCleanup(() => backlogEvents.offChange(changeHandler));

  function openMember(member: CollisionCandidateMember) {
    splitState.openMcpResource(collisionCandidateUri(member.id), app.homeSelection.value);
  }

  function renderMember(member: ReadonlySignal<CollisionCandidateMember>) {
    const id = computed(() => member.value.id);
    const title = computed(() => member.value.title);
    const digest = computed(() => member.value.digest);
    const uri = computed(() => collisionCandidateUri(member.value.id));
    const metadata = computed(() => {
      const value = member.value;
      const context = value.context ? ` · ${value.context}` : '';
      if (!value.kind && !value.context && value.entity_refs.length === 0 && value.tags.length === 0) {
        return null;
      }
      return html`<p class="collision-member-context">
        ${value.kind ?? 'memory'}${context}
        ${value.entity_refs.length ? ` · refs: ${value.entity_refs.join(', ')}` : ''}
        ${value.tags.length ? ` · tags: ${value.tags.join(', ')}` : ''}
      </p>`;
    });
    function handleMemberClick() {
      openMember(member.value);
    }
    return html`
      <article class="collision-member">
        <a href="${uri}" class="collision-member-link"
           @click.prevent=${handleMemberClick}>${id} — ${title}</a>
        <p class="collision-member-digest">${digest}</p>
        ${metadata}
      </article>
    `;
  }

  const pairRows = each(pairs, (pair) => pair.pair_id, (entry) => {
    const pair = computed<CollisionCandidatePair>(() => entry.value);
    const priority = computed(() => `review priority ${pair.value.pair_priority.toFixed(3)}`);
    const signals = computed(() => formatCollisionSignals(pair.value.signals));
    const firstMember = computed(() => pair.value.members[0]);
    const secondMember = computed(() => pair.value.members[1]);
    return html`
      <li class="collision-pair">
        <div class="collision-pair-heading">
          <span class="collision-priority">${priority}</span>
          <span class="collision-signals">${signals}</span>
        </div>
        <div class="collision-members">
          ${renderMember(firstMember)}
          ${renderMember(secondMember)}
        </div>
      </li>
    `;
  });

  const summaryView = computed(() => {
    const value = summary.value;
    const candidateLabel = value?.candidate_count === 1 ? 'candidate' : 'candidates';
    return value
      ? html`<p class="collision-summary">${value.candidate_count} ${candidateLabel} from ${value.focal_count} focal memories (${value.total_live_memories} live memories).</p>`
      : null;
  });

  const content = computed(() => {
    if (invalidHomeSelection.value) {
      return html`<div class="collision-state">Collision candidates are unavailable because this home selection is invalid.</div>`;
    }
    if (candidatesQuery.loading.value && !summary.value) {
      return html`<div class="collision-state">Loading collision candidates…</div>`;
    }
    if (error.value) {
      return html`<div class="collision-state collision-state--error">Collision candidates are unavailable: ${error}</div>`;
    }
    if (pairs.value.length === 0) {
      return html`<div class="collision-state">No collision candidates are currently queued for this home.</div>`;
    }
    return html`<ol class="collision-pair-list">${pairRows}</ol>`;
  });

  return html`
    <section class="collision-candidates" aria-label="Collision candidate queue">
      <p class="collision-guidance">Inspect both Markdown files. MCP can supersede, set a <code>state_key</code>, forget, or keep both. To dismiss a false collision, add <code>distinct_from</code> in Markdown or use the CLI <code>backlog update --fields</code> tail. This queue is read-only.</p>
      ${summaryView}
      ${content}
    </section>
  `;
});
