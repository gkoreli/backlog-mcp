/**
 * Desk types (attention-viewer proposal V1) — the contract between the
 * transport-free desk fold and its Node composition seams.
 *
 * Same DI law as wakeup (ADR 0090): core never touches the filesystem or
 * git; the composition hands it plain data through these shapes.
 */

import type { WakeupGrounding } from './types.js';

/** The four questions the Desk answers, in severity order. */
export type DeskClass = 'judge' | 'review' | 'read' | 'health';

/**
 * One catalog document as plain data, composed outside core: path + title
 * from the resource catalog, raw frontmatter fields read leniently, and a
 * last-change timestamp (frontmatter first, git recency fallback — the
 * same source order as wakeup's observed recency, at path granularity).
 */
export interface DeskDocument {
  /** Home-root-relative POSIX path — the document's stable address. */
  path: string;
  title: string;
  /** Raw declared frontmatter `status` (lossless; token rule applies in the fold). */
  status?: string;
  /**
   * Raw `attention:` frontmatter marker (reconciliation-sweep contract):
   * the marker's text when it is a string, or a bare '' for a non-string
   * truthy marker. Absent when the document carries no marker.
   */
  attention?: string;
  /** Raw frontmatter `author` line — the agent identity chip when present. */
  author?: string;
  /** Last-change ISO timestamp; absent when neither frontmatter nor git knows. */
  updatedAt?: string;
}

/** One mined evaluation-candidates file (docs/evaluation/candidates). */
export interface DeskEvaluationCandidateFile {
  /** Home-root-relative POSIX path of the .jsonl candidates file. */
  path: string;
  /**
   * Count of candidate_* records with no matching candidate_disposition
   * record — reviewed candidates leave the Desk (review 0001).
   */
  candidateCount: number;
  /**
   * Honest omission: why the reader did not count this file (oversized,
   * escapes the home). The fold discloses it; the file surfaces no item.
   */
  omission?: string;
}

/**
 * One Desk item. Every field the page shows is here; the viewer renders
 * verbatim and adds nothing (server composes, viewer renders).
 */
export interface DeskItem {
  id: string;
  title: string;
  class: DeskClass;
  /** One testable sentence naming the rule that surfaced this item. */
  why_surfaced: string;
  /** Copy-ready agent sentence — the read-only page's only handle. */
  instruction: string;
  /** Days since the fact behind this item last changed (0115 R-4 grammar). */
  age_days?: number;
  /** Home-root-relative path when the item is an openable document. */
  path?: string;
  /** Agent identity chip — the raw author line when the source declares one. */
  agent?: string;
}

export interface DeskParams {
  /** Catalog documents as plain data. Omit on runtimes without a docs catalog. */
  readDocuments?: () => DeskDocument[];
  /** Mined evaluation candidate files. Omit when the home has none. */
  readEvaluationCandidates?: () => DeskEvaluationCandidateFile[];
  /** The same grounding reader wakeup uses — worktree chip rides it. */
  readGrounding?: () => WakeupGrounding | undefined;
  /** Time anchor for every age computation; injectable for tests. */
  now?: number;
}

export interface DeskResult {
  /** ≤ budget items above the fold, worst-first across classes. */
  items: DeskItem[];
  /** Honest omission: per-class counts of surfaced-rule matches left out. */
  omitted: Record<DeskClass, number>;
  metadata: {
    generated_at: string;
    budget: number;
    /** Worktree chip (LATTICE W1) — present only in linked worktrees. */
    worktree?: string;
    /** Named degradations (e.g. collision scan unavailable) — never silent. */
    diagnostics?: string[];
  };
}
