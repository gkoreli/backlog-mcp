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
  WakeupGrounding,
  WakeupOrientationDoc,
} from '../core/types.js';
import { isNorthStarFilename, markdownTitle } from '../core/orientation.js';

export interface WakeupGroundingSources {
  home: Pick<BacklogHome, 'root' | 'documentsDir'>;
  /** Size of the home's indexed document catalog (resource manager list). */
  countIndexedDocuments?: () => number;
  /**
   * Observed recency (entity id → ISO timestamp) for documents lacking a
   * valid frontmatter `updated_at` — built from repository history/mtime
   * by the local composition (charter Slice B).
   */
  observedRecency?: () => Readonly<Record<string, string>>;
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

/** Build the per-call grounding reader the wakeup fold consumes. */
export function createWakeupGroundingReader(
  sources: WakeupGroundingSources,
): () => WakeupGrounding {
  return function readWakeupGrounding(): WakeupGrounding {
    return {
      ...discoverWakeupGrounding(sources.home),
      ...(sources.countIndexedDocuments === undefined
        ? {}
        : { indexedDocuments: sources.countIndexedDocuments() }),
      ...(sources.observedRecency === undefined
        ? {}
        : { observedRecency: sources.observedRecency() }),
    };
  };
}
