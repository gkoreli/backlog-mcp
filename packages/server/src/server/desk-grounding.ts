/**
 * Desk grounding discovery — the Node-side composition seam for the
 * transport-free desk fold (attention-viewer proposal V1).
 *
 * Mirrors wakeup-grounding.ts exactly: walk only the home's documents
 * surface, read frontmatter leniently, reuse the git recency source the
 * wakeup grounding already uses (frontmatter timestamps stay
 * authoritative; git orders the rest), and hand core plain data. Core
 * never touches the filesystem or git (ADR 0090).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import matter from 'gray-matter';
import type { Resource } from '@backlog-mcp/memory/search';
import type { BacklogHome } from '../core/backlog-home.types.js';
import type {
  DeskDocument,
  DeskEvaluationCandidateFile,
} from '../core/desk.types.js';
import { buildGitRecencyMap } from '../storage/local/git-recency.js';

export interface DeskGroundingSources {
  home: Pick<BacklogHome, 'root' | 'documentsDir'>;
  /** The home's indexed document catalog (resource manager list). */
  listResources: () => Resource[];
  /** Git last-commit dates per documents-dir-relative path; injectable for tests. */
  buildRecencyMap?: (documentsDir: string) => Record<string, string>;
}

function frontmatterData(content: string): Record<string, unknown> {
  try {
    return matter(content, {}).data as Record<string, unknown>;
  } catch {
    // Lenient by contract (Invariant 8): a malformed frontmatter block
    // means the document declares nothing — it stays on the Desk's radar
    // only through rules that need no frontmatter.
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * The attention marker, normalized losslessly: a string marker carries its
 * text; any other truthy scalar carries '' (marked, no reason recorded).
 */
function attentionMarker(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() ? value.trim() : '';
  }
  return value === undefined || value === null || value === false
    ? undefined
    : '';
}

/**
 * Frontmatter timestamps stay authoritative (charter Slice B law):
 * updated_at first, then date; git recency only fills the silence.
 */
function documentTimestamp(
  data: Record<string, unknown>,
  gitRecency: string | undefined,
): string | undefined {
  for (const field of ['updated_at', 'date']) {
    const raw = data[field];
    const value = raw instanceof Date ? raw.toISOString() : raw;
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
      return value;
    }
  }
  return gitRecency;
}

/** Build the per-call documents reader the desk fold consumes. */
export function createDeskDocumentsReader(
  sources: DeskGroundingSources,
): () => DeskDocument[] {
  const buildRecency = sources.buildRecencyMap ?? buildGitRecencyMap;
  const documentsPrefix = relative(sources.home.root, sources.home.documentsDir)
    .split(sep)
    .join('/');

  return function readDeskDocuments(): DeskDocument[] {
    const recency = buildRecency(sources.home.documentsDir);
    return sources.listResources()
      .filter(function isMarkdown(resource) {
        return /\.(?:md|markdown)$/iu.test(resource.path);
      })
      .map(function toDeskDocument(resource): DeskDocument {
        const data = frontmatterData(resource.content);
        // The git map is documents-dir-relative; catalog paths are
        // home-root-relative. Repo-root orientation files simply miss.
        const docsRelative = documentsPrefix !== ''
          && resource.path.startsWith(`${documentsPrefix}/`)
          ? resource.path.slice(documentsPrefix.length + 1)
          : resource.path;
        const updatedAt = documentTimestamp(data, recency[docsRelative]);
        const status = stringValue(data['status']);
        const author = stringValue(data['author']);
        const attention = attentionMarker(data['attention']);
        return {
          path: resource.path,
          title: resource.title,
          ...(status === undefined ? {} : { status }),
          ...(attention === undefined ? {} : { attention }),
          ...(author === undefined ? {} : { author }),
          ...(updatedAt === undefined ? {} : { updatedAt }),
        };
      });
  };
}

const CANDIDATES_DIR = 'evaluation/candidates';
const CANDIDATE_RECORD = /^candidate_/u;

function countCandidateRecords(content: string): number {
  let count = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const record: unknown = JSON.parse(trimmed);
      if (
        typeof record === 'object'
        && record !== null
        && typeof (record as { record?: unknown }).record === 'string'
        && CANDIDATE_RECORD.test((record as { record: string }).record)
      ) {
        count += 1;
      }
    } catch {
      // A malformed line is not a candidate; the miner's own counts stay
      // the authority — the Desk only surfaces what it can actually read.
    }
  }
  return count;
}

/**
 * Read the miner's candidate files (docs/evaluation/candidates/*.jsonl).
 * Detection stays the miner's; this reader only counts its records.
 */
export function createEvaluationCandidatesReader(
  home: Pick<BacklogHome, 'root' | 'documentsDir'>,
): () => DeskEvaluationCandidateFile[] {
  return function readEvaluationCandidates(): DeskEvaluationCandidateFile[] {
    const candidatesDir = join(home.documentsDir, ...CANDIDATES_DIR.split('/'));
    let names: string[];
    try {
      names = readdirSync(candidatesDir, { encoding: 'utf8' }).sort();
    } catch {
      return [];
    }

    const files: DeskEvaluationCandidateFile[] = [];
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const absolutePath = join(candidatesDir, name);
      try {
        if (!statSync(absolutePath).isFile()) continue;
        const content = readFileSync(absolutePath, 'utf-8');
        files.push({
          path: posix.join(
            relative(home.root, home.documentsDir).split(sep).join('/'),
            CANDIDATES_DIR,
            name,
          ),
          candidateCount: countCandidateRecords(content),
        });
      } catch {
        // An unreadable file stays off the Desk rather than aborting it.
      }
    }
    return files;
  };
}
