/**
 * Canonical-law freshness probe (LATTICE W2, worktree-native charter).
 *
 * W1 taught a linked-worktree home its family and how far it sits behind
 * the family's default branch. W2 asks the sharper question for the
 * documents whose staleness actually hurts — the LAW-shaped ones (the
 * vision document and the requirement sources behind the constraints
 * section): does this worktree's copy match the canonical committed
 * content, and if not, which side moved?
 *
 * Detection is content-hash comparison, never a textual diff (design
 * ruling 4): one `git ls-tree` at a pinned canonical commit yields the
 * canonical blob ids for every law path in a single spawn, and each
 * worktree copy is hashed in-process (plain file read + git's blob
 * header: `blob <len>\0<bytes>`, algorithm matched to the repository's
 * object format by the canonical hash width). No spawn per section, no
 * spawn per file.
 *
 * At most ONE canonical content read rides a probe (design ruling 3):
 * when — and only when — the vision document is not canonical-fresh, its
 * committed content is read through the W1 seam (`git show <sha>:<path>`)
 * so the briefing can serve the CANONICAL title. The read is pinned to
 * the resolved commit SHA and cached per process; re-briefing at an
 * unmoved canonical tip spawns nothing.
 *
 * Fail-open like every git adapter in this layer: missing git, unknown
 * default branch, unreadable files, or paths outside the repository
 * return no verdict rather than a wrong one — and a probe that fails
 * yields today's W1-only briefing, byte-identical.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { readCanonicalFile } from './git-canonical-read.js';
import { runGitCommand, type GitRunner } from './git-runner.js';

const FULL_SHA_PATTERN = /^[0-9a-f]{40,64}$/;

/** `<mode> blob <hash>\t<path>` — one `ls-tree -z` record. */
const LS_TREE_BLOB_PATTERN = /^\d+ blob ([0-9a-f]{40,64})\t(.+)$/s;

/**
 * Per-process cache for the single canonical content read (ruling 3).
 * Keys are `<commit>:<path>` — content-addressed, so entries can never go
 * stale; a moved default branch changes the key. `undefined` failures are
 * cached too: a read pinned to a SHA is deterministic either way.
 */
const MAX_CACHED_CANONICAL_READS = 32;
const canonicalContentCache = new Map<string, string | undefined>();

export interface CanonicalLawVision {
  /**
   * How the worktree's vision document relates to canonical law:
   * `diverged` — both exist, content differs; `worktree_missing` — only
   * canonical has one (the pointer can still be served); and
   * `canonical_missing` — only the worktree has one (worktree-only law).
   */
  state: 'diverged' | 'worktree_missing' | 'canonical_missing';
  /** Home-root-relative POSIX path of the vision document. */
  path: string;
  /**
   * Canonical committed content at `commit` — present for `diverged` and
   * `worktree_missing` unless the pinned read failed (fail-open: the
   * divergence fact stands, the canonical title is simply unavailable).
   */
  content?: string;
}

/** Law freshness of one linked worktree against its pinned canonical tip. */
export interface CanonicalLawProbe {
  /** Full SHA of the pinned canonical commit (default branch tip). */
  commit: string;
  /** Present only when the vision document is NOT canonical-fresh. */
  vision?: CanonicalLawVision;
  /** True when any constraint source differs from its canonical blob. */
  constraintsDiverged: boolean;
}

export interface ProbeCanonicalLawParams {
  /** The worktree home root (any directory inside the linked worktree). */
  homeRoot: string;
  /** The home's documents directory (constraint source paths are relative to it). */
  documentsDir: string;
  /** The family's default branch — where canonical truth lives (W1). */
  defaultBranch: string;
  /**
   * Home-root-relative path of the worktree's own vision document, when
   * discovery found exactly one. Omit when discovery found none — the
   * probe then looks for a single canonical copy (`worktree_missing`).
   */
  visionPath?: string;
  /**
   * True when worktree discovery found MULTIPLE vision candidates: the
   * ambiguity diagnostic owns the briefing line, so vision law is skipped
   * entirely — never a silent pick, not even a canonical one.
   */
  visionAmbiguous?: boolean;
  /**
   * Vision filename rule for the canonical fallback listing (injected so
   * this git adapter carries no orientation policy of its own).
   */
  isVisionFilename?: (filename: string) => boolean;
  /** documentsDir-relative source paths of the requirement documents. */
  constraintSourcePaths?: readonly string[];
  /** Injectable runner (tests, fail-open probes). */
  runGit?: GitRunner;
  /**
   * Injectable raw-byte reader — worktree blob hashing needs the file's
   * exact bytes. Defaults to `node:fs`; tests substitute their own.
   */
  readFileBytes?: (absolutePath: string) => Buffer | undefined;
}

function defaultReadFileBytes(absolutePath: string): Buffer | undefined {
  try {
    return readFileSync(absolutePath);
  } catch {
    return undefined;
  }
}

/**
 * Git blob hash of raw bytes: `<algo>("blob <len>\0" + bytes)`. The
 * algorithm follows the repository's object format, detected from the
 * canonical hash width (40 hex chars = sha1, 64 = sha256).
 */
function blobHash(bytes: Buffer, canonicalHash: string): string {
  const hash = createHash(canonicalHash.length === 64 ? 'sha256' : 'sha1');
  hash.update(`blob ${bytes.length}\0`);
  hash.update(bytes);
  return hash.digest('hex');
}

/** Repo-root-relative POSIX path, or undefined when outside the repo. */
function repoRelative(
  toplevel: string,
  absolutePath: string,
): string | undefined {
  const rel = relative(toplevel, absolutePath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return rel.split(sep).join('/');
}

/** Parse `ls-tree -z` output into path → blob hash (blobs only). */
function parseLsTreeBlobs(output: string): Map<string, string> {
  const blobs = new Map<string, string>();
  for (const record of output.split('\0')) {
    if (record === '') continue;
    const match = LS_TREE_BLOB_PATTERN.exec(record);
    const hash = match?.[1];
    const path = match?.[2];
    if (hash !== undefined && path !== undefined) blobs.set(path, hash);
  }
  return blobs;
}

/** The single cached canonical content read (ruling 3) — W1's seam. */
function readCanonicalLawContent(
  cwd: string,
  commit: string,
  path: string,
  runGit: GitRunner,
): string | undefined {
  const key = `${commit}:${path}`;
  if (canonicalContentCache.has(key)) return canonicalContentCache.get(key);
  const read = readCanonicalFile({ cwd, ref: commit, path, runGit });
  if (canonicalContentCache.size >= MAX_CACHED_CANONICAL_READS) {
    canonicalContentCache.clear();
  }
  canonicalContentCache.set(key, read?.content);
  return read?.content;
}

/**
 * When the worktree has NO vision document, look for exactly one in the
 * canonical tree — same roots (repo root + docs root) and same filename
 * rule as worktree discovery, listed at the pinned commit. Multiple
 * canonical candidates return nothing: never a silent pick.
 */
function findCanonicalVisionPath(
  toplevel: string,
  commit: string,
  documentsDirRepoPath: string | undefined,
  isVisionFilename: (filename: string) => boolean,
  runGit: GitRunner,
): string | undefined {
  const candidates = new Set<string>();
  const roots = documentsDirRepoPath === undefined
    ? [undefined]
    : [undefined, documentsDirRepoPath];
  for (const root of roots) {
    const listed = runGit(toplevel, [
      'ls-tree',
      '-z',
      root === undefined ? commit : `${commit}:${root}`,
    ]);
    if (listed === undefined) continue;
    for (const [name] of parseLsTreeBlobs(listed)) {
      if (!isVisionFilename(name)) continue;
      candidates.add(root === undefined ? name : `${root}/${name}`);
    }
  }
  if (candidates.size !== 1) return undefined;
  return [...candidates][0];
}

/**
 * Probe one linked worktree's law-shaped documents against the family's
 * canonical tip. Returns the pinned commit plus only the facts that are
 * NOT fresh; a fully fresh worktree returns `{ commit,
 * constraintsDiverged: false }` and no vision facts. Undefined on any
 * probe failure (fail-open, never throws).
 */
export function probeCanonicalLaw(
  params: ProbeCanonicalLawParams,
): CanonicalLawProbe | undefined {
  const runGit = params.runGit ?? runGitCommand;
  const readFileBytes = params.readFileBytes ?? defaultReadFileBytes;

  // One spawn answers "where is this worktree's repo root?" and "what
  // commit is canonical right now?" together. A missing default branch
  // fails the whole command — no law facts, today's briefing.
  const pinned = runGit(params.homeRoot, [
    'rev-parse',
    '--show-toplevel',
    `${params.defaultBranch}^{commit}`,
  ]);
  if (pinned === undefined) return undefined;
  const [toplevelLine, commitLine] = pinned.trim().split('\n').map(line => line.trim());
  if (!toplevelLine || commitLine === undefined || !FULL_SHA_PATTERN.test(commitLine)) {
    return undefined;
  }
  const toplevel: string = toplevelLine;
  const commit: string = commitLine;

  const visionRepoPath = params.visionPath === undefined || params.visionAmbiguous === true
    ? undefined
    : repoRelative(toplevel, resolve(params.homeRoot, ...params.visionPath.split('/')));
  const constraintRepoPaths: string[] = [];
  for (const sourcePath of params.constraintSourcePaths ?? []) {
    const repoPath = repoRelative(
      toplevel,
      resolve(params.documentsDir, ...sourcePath.split('/')),
    );
    if (repoPath !== undefined) constraintRepoPaths.push(repoPath);
  }

  // ONE ls-tree lists every law path's canonical blob id (ruling 3's
  // spirit: sections never multiply spawns). Paths absent from the pinned
  // tree are simply absent from the map.
  const lawPaths = [...new Set([
    ...(visionRepoPath === undefined ? [] : [visionRepoPath]),
    ...constraintRepoPaths,
  ])];
  let canonicalBlobs = new Map<string, string>();
  if (lawPaths.length > 0) {
    const listed = runGit(toplevel, ['ls-tree', '-z', commit, '--', ...lawPaths]);
    if (listed === undefined) return undefined;
    canonicalBlobs = parseLsTreeBlobs(listed);
  }

  // true = content differs; false = canonical-fresh; undefined = no
  // verdict (unreadable worktree copy — fail open, never a false stub).
  function worktreeDiffers(repoPath: string): boolean | undefined {
    const canonicalHash = canonicalBlobs.get(repoPath);
    if (canonicalHash === undefined) return true; // worktree-only law
    const bytes = readFileBytes(resolve(toplevel, ...repoPath.split('/')));
    if (bytes === undefined) return undefined;
    return blobHash(bytes, canonicalHash) !== canonicalHash;
  }

  let vision: CanonicalLawVision | undefined;
  if (params.visionAmbiguous !== true) {
    if (visionRepoPath !== undefined && params.visionPath !== undefined) {
      if (!canonicalBlobs.has(visionRepoPath)) {
        vision = { state: 'canonical_missing', path: params.visionPath };
      } else if (worktreeDiffers(visionRepoPath) === true) {
        const content = readCanonicalLawContent(
          params.homeRoot, commit, visionRepoPath, runGit,
        );
        vision = {
          state: 'diverged',
          path: params.visionPath,
          ...(content === undefined ? {} : { content }),
        };
      }
    } else if (params.visionPath === undefined && params.isVisionFilename !== undefined) {
      const canonicalPath = findCanonicalVisionPath(
        toplevel,
        commit,
        repoRelative(toplevel, params.documentsDir),
        params.isVisionFilename,
        runGit,
      );
      if (canonicalPath !== undefined) {
        const absolutePath = resolve(toplevel, ...canonicalPath.split('/'));
        const homePath = relative(params.homeRoot, absolutePath);
        // A canonical vision outside the home cannot be addressed by the
        // briefing's home-relative pointer grammar — skip it.
        if (homePath !== '' && !homePath.startsWith('..') && !isAbsolute(homePath)) {
          const content = readCanonicalLawContent(
            params.homeRoot, commit, canonicalPath, runGit,
          );
          vision = {
            state: 'worktree_missing',
            path: homePath.split(sep).join('/'),
            ...(content === undefined ? {} : { content }),
          };
        }
      }
    }
  }

  let constraintsDiverged = false;
  for (const repoPath of constraintRepoPaths) {
    if (worktreeDiffers(repoPath) === true) {
      constraintsDiverged = true;
      break;
    }
  }

  return {
    commit,
    ...(vision === undefined ? {} : { vision }),
    constraintsDiverged,
  };
}
