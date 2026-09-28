import { isAbsolute, join, relative } from 'node:path';
import type { BacklogHome } from './backlog-home.types.js';
import {
  presentGlobalHome,
  presentProjectHome,
} from './home-presentation.js';
import type {
  HomeProvenance,
  WrittenDocument,
  WrittenDocumentsProvenance,
} from './home-provenance.types.js';

/**
 * Project a `BacklogHome` into the provenance every adapter returns with a
 * result (ADR 0112 R-9: `home`, `home_id`, `source_path`), plus render-ready
 * presentation (ADR 0128). One projection shared by HTTP and CLI, so no
 * adapter rebuilds it. Pure (ADR 0090): the composition injects `homeDir`.
 */
export function projectHomeProvenance(
  home: BacklogHome,
  homeDir: string | undefined,
  sourcePath?: string,
): HomeProvenance {
  const presentation = home.kind === 'global'
    ? presentGlobalHome(home.root, homeDir)
    : presentProjectHome(home.root, homeDir);

  return {
    home: home.kind,
    home_id: home.id,
    root: home.root,
    documents_dir: home.documentsDir,
    label: presentation.label,
    display_path: presentation.display_path,
    ...(sourcePath === undefined ? {} : { source_path: sourcePath }),
  };
}

/**
 * Project a home once plus each written document, for a write that touched
 * several documents (ADR 0134.1 R4.3). Pure: `homeDir` is injected.
 */
export function projectWrittenDocuments(
  home: BacklogHome,
  homeDir: string | undefined,
  documents: readonly WrittenDocument[],
): WrittenDocumentsProvenance {
  const { source_path: _sourcePath, ...homeFields } = projectHomeProvenance(home, homeDir);
  return { ...homeFields, documents: [...documents] };
}

/**
 * Where a document lives, from the home root: `docs/tasks/TASK-0001-….md`.
 * Source paths are relative to the documents dir; a documents dir outside the
 * root is shown as an absolute path.
 */
function documentPathFromRoot(provenance: Partial<HomeProvenance>): string | undefined {
  const { source_path: sourcePath, root, documents_dir: documentsDir } = provenance;
  if (sourcePath === undefined) return undefined;
  if (root === undefined || documentsDir === undefined) return sourcePath;
  const absolute = isAbsolute(sourcePath) ? sourcePath : join(documentsDir, sourcePath);
  const fromRoot = relative(root, absolute);
  return fromRoot.startsWith('..') ? absolute : fromRoot;
}

/**
 * One human-readable line naming where a write landed, e.g.
 * `project home ~/code/app: docs/tasks/TASK-0001-x.md` (ADR 0134 R3.5).
 * Every adapter prints this same line. Undefined without a home.
 */
export function describeDocumentLocation(
  provenance: Partial<HomeProvenance>,
): string | undefined {
  if (provenance.home === undefined) return undefined;
  const home = provenance.home === 'global'
    ? 'global home'
    : `project home ${provenance.display_path ?? provenance.home_id}`;
  const file = documentPathFromRoot(provenance);
  return file === undefined ? home : `${home}: ${file}`;
}
