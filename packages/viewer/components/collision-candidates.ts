/**
 * collision-candidates.ts — Read-only, server-authoritative review queue.
 *
 * The server supplies the total order. This component deliberately renders
 * `pairs` as received: collision candidates are adjudication pressure, not a
 * client-side ranking surface.
 */
import { computed, component, each, html, inject, onCleanup, query } from '@nisli/core';
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

  function renderMember(member: CollisionCandidateMember) {
    const context = member.context ? ` · ${member.context}` : '';
    function handleMemberClick() {
      openMember(member);
    }
    return html`
      <article class="collision-member">
        <a href="${collisionCandidateUri(member.id)}" class="collision-member-link"
           @click.prevent=${handleMemberClick}>${member.id} — ${member.title}</a>
        <p class="collision-member-digest">${member.digest}</p>
        ${member.kind || member.context || member.entity_refs.length || member.tags.length
          ? html`<p class="collision-member-context">
              ${member.kind ?? 'memory'}${context}
              ${member.entity_refs.length ? ` · refs: ${member.entity_refs.join(', ')}` : ''}
              ${member.tags.length ? ` · tags: ${member.tags.join(', ')}` : ''}
            </p>`
          : null}
      </article>
    `;
  }

  const pairRows = each(pairs, (pair) => pair.pair_id, (entry) => {
    const pair = entry.value as CollisionCandidatePair;
    return html`
      <li class="collision-pair">
        <div class="collision-pair-heading">
          <span class="collision-priority">review priority ${pair.pair_priority.toFixed(3)}</span>
          <span class="collision-signals">${formatCollisionSignals(pair.signals)}</span>
        </div>
        <div class="collision-members">
          ${renderMember(pair.members[0])}
          ${renderMember(pair.members[1])}
        </div>
      </li>
    `;
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
      <p class="collision-guidance">Inspect both Markdown files, then adjudicate with the existing memory update fields—for example <code>distinct_from</code> or supersession. This queue is read-only.</p>
      ${summary.value ? html`<p class="collision-summary">${summary.value.candidate_count} candidates from ${summary.value.focal_count} focal memories (${summary.value.total_live_memories} live memories).</p>` : null}
      ${content}
    </section>
  `;
});
