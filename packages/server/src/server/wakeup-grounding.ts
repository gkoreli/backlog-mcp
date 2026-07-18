/**
 * Wakeup grounding discovery (first-impression charter, Slices A/B).
 *
 * The Node-side composition seam for the transport-free wakeup fold: walk
 * only the repo/docs roots for the bounded orientation set, apply the
 * north-star vision rule, and hand core plain data. Core never touches the
 * filesystem — same DI law as identity/vision/operations (ADR 0090).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type {
  WakeupCanonicalLaw,
  WakeupGrounding,
  WakeupOrientationDoc,
} from '../core/types.js';
import { isNorthStarFilename, markdownTitle } from '../core/orientation.js';
import type { DocumentStorageAdapter } from '../storage/storage-adapter.js';
import {
  countCommitsAhead,
  countCommitsBehind,
} from '../storage/local/git-family.js';
import {
  probeCanonicalLaw,
  type CanonicalLawProbe,
  type ProbeCanonicalLawParams,
} from '../storage/local/git-law-freshness.js';
import { buildGitRecencyMap } from '../storage/local/git-recency.js';

/** Short-SHA width for the divergence stubs' canonical anchor. */
const CANONICAL_SHORT_SHA_CHARS = 7;

export interface WakeupGroundingSources {
  home: Pick<BacklogHome, 'root' | 'documentsDir' | 'family'>;
  /** Size of the home's indexed document catalog (resource manager list). */
  countIndexedDocuments?: () => number;
  /**
   * Observed recency (entity id → ISO timestamp) for documents lacking a
   * valid frontmatter `updated_at` — built from repository history/mtime
   * by the local composition (charter Slice B).
   */
  observedRecency?: () => Readonly<Record<string, string>>;
  /**
   * Divergence probe for linked-worktree homes (LATTICE W1): commits the
   * checkout is behind the family's default branch. Defaults to the real
   * git probe; injectable for tests. A failed probe (undefined) omits
   * the worktree grounding entirely — the meta line always carries all
   * three facts or none (fail-open).
   */
  countCommitsBehind?: (
    root: string,
    defaultBranch: string,
  ) => number | undefined;
  /**
   * documentsDir-relative source paths of the home's law-shaped
   * constraint documents — the requirement sources (compiled AND
   * quarantined) behind the briefing's constraints section (LATTICE W2).
   * Omitted or empty: constraint freshness is simply not probed.
   */
  listConstraintSourcePaths?: () => readonly string[];
  /**
   * Injectable canonical-law probe (LATTICE W2); defaults to the real
   * git probe. A failed probe (undefined) omits law facts entirely —
   * the briefing stays byte-identical to W1 (fail-open).
   */
  probeCanonicalLaw?: (
    params: ProbeCanonicalLawParams,
  ) => CanonicalLawProbe | undefined;
  /**
   * Ahead-count probe for the divergence stub's drift wording, consulted
   * only when law diverged while the checkout is 0 behind (LATTICE W2).
   */
  countCommitsAhead?: (root: string, ref: string) => number | undefined;
}

/**
 * Worktree grounding (LATTICE W1): present only when home resolution
 * attached a family — i.e. the home root is a linked worktree. Divergence
 * is probed per briefing (it moves as the family's default branch does),
 * while the family facts rode in on the resolved home.
 */
function discoverWorktreeGrounding(
  home: WakeupGroundingSources['home'],
  probeBehind: NonNullable<WakeupGroundingSources['countCommitsBehind']>,
): WakeupGrounding['worktree'] {
  const family = home.family;
  if (family === undefined) return undefined;
  const behind = probeBehind(home.root, family.defaultBranch);
  if (behind === undefined) return undefined;
  return {
    family: family.name,
    branch: family.branch,
    defaultBranch: family.defaultBranch,
    behind,
  };
}

/**
 * Canonical-law grounding for a linked-worktree home (LATTICE W2): probe
 * the law-shaped documents (vision + requirement sources) against the
 * family default branch's pinned tip and hand core plain facts — the
 * short canonical anchor, the vision state with its CANONICAL title, and
 * whether any constraint source diverged. Returns undefined when every
 * law document is canonical-fresh OR any probe fails: absent facts fold
 * to a briefing byte-identical to W1 (fail-open, both directions).
 */
function discoverCanonicalLawGrounding(
  sources: WakeupGroundingSources,
  worktree: NonNullable<WakeupGrounding['worktree']>,
  visionCandidates: readonly string[],
): WakeupCanonicalLaw | undefined {
  const probe = sources.probeCanonicalLaw ?? probeCanonicalLaw;
  const singleVision = visionCandidates.length === 1
    ? visionCandidates[0]
    : undefined;
  const law = probe({
    homeRoot: sources.home.root,
    documentsDir: sources.home.documentsDir,
    defaultBranch: worktree.defaultBranch,
    ...(singleVision === undefined ? {} : { visionPath: singleVision }),
    ...(visionCandidates.length > 1 ? { visionAmbiguous: true } : {}),
    isVisionFilename: isNorthStarFilename,
    constraintSourcePaths: sources.listConstraintSourcePaths?.() ?? [],
  });
  if (law === undefined) return undefined;
  if (law.vision === undefined && !law.constraintsDiverged) return undefined;

  // The stub names the drift; `behind` (W1) already rides the worktree
  // facts, so only the behind-0 divergence needs one more probe.
  const needsAhead = worktree.behind === 0
    && (law.vision?.state === 'diverged' || law.constraintsDiverged);
  const ahead = needsAhead
    ? (sources.countCommitsAhead ?? countCommitsAhead)(
        sources.home.root,
        law.commit,
      )
    : undefined;

  let vision: WakeupCanonicalLaw['vision'];
  if (law.vision !== undefined) {
    const filename = law.vision.path.split('/').at(-1) ?? law.vision.path;
    const title = law.vision.content === undefined
      ? undefined
      : markdownTitle(law.vision.content, fileStem(filename));
    vision = {
      state: law.vision.state,
      path: law.vision.path,
      ...(title === undefined ? {} : { title }),
    };
  }

  return {
    commit: law.commit.slice(0, CANONICAL_SHORT_SHA_CHARS),
    ...(ahead !== undefined && ahead > 0 ? { ahead } : {}),
    ...(vision === undefined ? {} : { vision }),
    ...(law.constraintsDiverged ? { constraintsDiverged: true } : {}),
  };
}

function listDirectory(path: string): string[] {
  try {
    return readdirSync(path, { encoding: 'utf8' }).sort();
  } catch {
    return [];
  }
}

function readFileTitle(absolutePath: string, fallback: string): string | undefined {
  try {
    if (!statSync(absolutePath).isFile()) return undefined;
    return markdownTitle(readFileSync(absolutePath, 'utf-8'), fallback);
  } catch {
    return undefined;
  }
}

function rootRelative(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/');
}

function fileStem(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * Discover the bounded orientation set for one home: repo-root README.md /
 * AGENTS.md, the vision document (north-star filename rule over the repo
 * and docs roots only), and index documents — README.md at the docs root
 * and directly inside each first-level docs folder. Paths are home-root
 * relative; every one of them is a resource-catalog address.
 */
export function discoverWakeupGrounding(
  home: Pick<BacklogHome, 'root' | 'documentsDir'>,
): Pick<WakeupGrounding, 'orientation' | 'visionCandidates'> {
  const docs: WakeupOrientationDoc[] = [];

  function addDoc(
    absolutePath: string,
    role: WakeupOrientationDoc['role'],
  ): void {
    const path = rootRelative(home.root, absolutePath);
    const title = readFileTitle(absolutePath, fileStem(path.split('/').at(-1) ?? path));
    if (title !== undefined) docs.push({ path, role, title });
  }

  addDoc(join(home.root, 'README.md'), 'readme');
  addDoc(join(home.root, 'AGENTS.md'), 'agents');

  // Vision rule (charter Slice A): repo root and docs root only, filename
  // stem `northstar` after case-folding and removing -/_. One match is the
  // pointer; multiple matches surface as candidates, never a silent choice.
  const visionRoots = home.documentsDir === home.root
    ? [home.root]
    : [home.root, home.documentsDir];
  const visionCandidates: string[] = [];
  for (const dir of visionRoots) {
    for (const name of listDirectory(dir)) {
      if (!isNorthStarFilename(name)) continue;
      try {
        if (!statSync(join(dir, name)).isFile()) continue;
      } catch {
        continue;
      }
      visionCandidates.push(rootRelative(home.root, join(dir, name)));
    }
  }
  if (visionCandidates.length === 1 && visionCandidates[0] !== undefined) {
    addDoc(join(home.root, ...visionCandidates[0].split('/')), 'vision');
  }

  // Index documents: existing human-maintained tables of contents. Bounded
  // rule — docs/README.md plus README.md directly inside each first-level
  // docs folder. The fold applies the remaining pointer budget.
  if (home.documentsDir !== home.root) {
    addDoc(join(home.documentsDir, 'README.md'), 'index');
  }
  for (const name of listDirectory(home.documentsDir)) {
    const child = join(home.documentsDir, name);
    try {
      if (!statSync(child).isDirectory()) continue;
    } catch {
      continue;
    }
    addDoc(join(child, 'README.md'), 'index');
  }

  return { orientation: docs, visionCandidates };
}

/**
 * Observed recency for documents lacking a valid frontmatter `updated_at`
 * (charter Slice B, staging-verified): the git last-commit date per source
 * path, with the discovery-level mtime as the fallback for untracked
 * files. Explicit frontmatter timestamps stay authoritative — they are
 * simply absent from this map.
 */
export function createObservedRecencyReader(
  storage: Pick<DocumentStorageAdapter, 'iterateDocuments'>,
  documentsDir: string,
): () => Record<string, string> {
  return function readObservedRecency(): Record<string, string> {
    const gitDates = buildGitRecencyMap(documentsDir);
    const map: Record<string, string> = {};
    for (const document of storage.iterateDocuments()) {
      const updated = document.entity.updated_at;
      if (typeof updated === 'string' && !Number.isNaN(Date.parse(updated))) {
        continue;
      }
      const observed = gitDates[document.sourcePath]
        ?? document.identity.observedDate;
      if (observed !== undefined) map[document.entity.id] = observed;
    }
    return map;
  };
}

/** Build the per-call grounding reader the wakeup fold consumes. */
export function createWakeupGroundingReader(
  sources: WakeupGroundingSources,
): () => WakeupGrounding {
  const probeBehind = sources.countCommitsBehind ?? countCommitsBehind;
  return function readWakeupGrounding(): WakeupGrounding {
    const base = discoverWakeupGrounding(sources.home);
    const worktree = discoverWorktreeGrounding(sources.home, probeBehind);
    // Canonical-law facts (LATTICE W2) exist only for worktree homes and
    // only when law diverged — everything else stays absent-cheap.
    const law = worktree === undefined
      ? undefined
      : discoverCanonicalLawGrounding(
          sources,
          worktree,
          base.visionCandidates ?? [],
        );
    return {
      ...base,
      ...(sources.countIndexedDocuments === undefined
        ? {}
        : { indexedDocuments: sources.countIndexedDocuments() }),
      ...(sources.observedRecency === undefined
        ? {}
        : { observedRecency: sources.observedRecency() }),
      ...(worktree === undefined
        ? {}
        : { worktree: law === undefined ? worktree : { ...worktree, law } }),
    };
  };
}
