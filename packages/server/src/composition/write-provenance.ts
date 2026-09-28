/**
 * Turn written document ids into provenance (ADR 0134 R3.5, ADR 0134.1 R4.2).
 * The one place a write's id becomes `home`/`home_id`/`source_path`; the CLI
 * and MCP adapters both receive it from here. `homeDir` is injected by the
 * caller so this stays free of Node IO (ADR 0091).
 */
import type { BacklogHome } from '../core/backlog-home.types.js';
import {
  projectHomeProvenance,
  projectWrittenDocuments,
} from '../core/home-provenance.js';
import type {
  HomeProvenance,
  WrittenDocumentsProvenance,
} from '../core/home-provenance.types.js';

/** Where writes landed, for one runtime. */
export interface WriteProvenance {
  /** A write about one document: flat provenance, like HTTP entity responses. */
  document(id: string): Partial<HomeProvenance>;
  /** A write about several documents: the home once, then each document. */
  documents(ids: readonly string[]): Partial<WrittenDocumentsProvenance>;
}

/** The runtime facts a write's provenance needs. */
export interface WriteProvenanceSource {
  home?: BacklogHome;
  getSourcePath?: (id: string) => string | undefined;
}

/**
 * Build the write-provenance reader for one runtime. A runtime without a home
 * (legacy or Worker) yields empty provenance, so results keep their old shape.
 */
export function createWriteProvenance(
  source: WriteProvenanceSource,
  homeDir: string | undefined,
): WriteProvenance {
  const home = source.home;
  return {
    document: function documentProvenance(id) {
      return home === undefined
        ? {}
        : projectHomeProvenance(home, homeDir, source.getSourcePath?.(id));
    },
    documents: function documentsProvenance(ids) {
      if (home === undefined) return {};
      return projectWrittenDocuments(home, homeDir, ids.map(function toDocument(id) {
        const sourcePath = source.getSourcePath?.(id);
        return sourcePath === undefined ? { id } : { id, source_path: sourcePath };
      }));
    },
  };
}
