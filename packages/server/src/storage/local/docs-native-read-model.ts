import { discoverDocuments } from '../../core/document-discovery.js';
import type { BacklogHome } from '../../core/backlog-home.types.js';
import { claimSubstrateDocuments, type ClaimedSubstrateDocument, type ProjectSubstrateRegistry } from '../../core/substrates/index.js';
import { formatStorageDisplayId } from '../storage-identity.js';
import type { ClaimQuarantine, StoredEntityDocument } from '../storage-adapter.js';
import type { RuntimeEntity } from '@backlog-mcp/shared';
import matter from 'gray-matter';

/** Derived read projections and authoritative filename claims from one disk scan. */
export interface DocumentSnapshot {
  documents: StoredEntityDocument[];
  quarantines: ClaimQuarantine[];
  claimDiagnostics: readonly { type: string; sourcePaths: readonly string[] }[];
  byId: Map<string, StoredEntityDocument>;
  bySourcePath: Map<string, StoredEntityDocument>;
  identitiesByType: Map<string, Set<string>>;
  maxIds: Map<string, number>;
  incompletePaths: readonly string[];
}

function firstHeading(content: string): string | undefined {
  const heading = /^\s*#\s+(.+?)\s*$/mu.exec(content)?.[1]?.trim();
  return heading || undefined;
}

function stringField(
  data: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = data[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

interface ParsedClaimedDocument {
  document?: StoredEntityDocument;
  quarantine?: ClaimQuarantine;
}

function quarantineClaim(
  claimed: ClaimedSubstrateDocument,
  reason: string,
): ParsedClaimedDocument {
  return {
    quarantine: {
      type: claimed.type,
      sourcePath: claimed.document.sourcePath,
      reason,
    },
  };
}

function parseStoredDocument(
  claimed: ClaimedSubstrateDocument,
  registry: ProjectSubstrateRegistry,
): ParsedClaimedDocument {
  const document = claimed.document;
  if (document.format !== 'markdown' || document.content === undefined) {
    return quarantineClaim(claimed, 'document is not readable markdown');
  }

  try {
    const parsedMarkdown = matter(document.content, {});
    const data = parsedMarkdown.data as Record<string, unknown>;
    const claim = registry.getStorageClaim(claimed.type);
    if (claim === undefined) return {};

    const id = formatStorageDisplayId(claim, claimed.storageKey);
    const title = stringField(data, 'title')
      ?? firstHeading(parsedMarkdown.content)
      ?? document.identity.slug
      ?? id;
    const content = parsedMarkdown.content.trim();
    const projection: RuntimeEntity = {
      ...data,
      id,
      type: claimed.type,
      title,
      ...(content ? { content } : {}),
    };

    return {
      document: {
        entity: projection,
        sourcePath: document.sourcePath,
        identity: document.identity,
        markdown: document.content,
      },
    };
  } catch (error) {
    // A claimed document that cannot compile stays quarantined as a generic
    // lossless resource (EXP-1 B-3). The visible record here is what keeps
    // typed disclosure from silently implying completeness.
    return quarantineClaim(
      claimed,
      `frontmatter cannot parse: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Scan this home's markdown once; malformed bodies still reserve their filename IDs. */
export function readDocumentSnapshot(
  home: BacklogHome,
  registry: ProjectSubstrateRegistry,
): DocumentSnapshot {
  const discovery = discoverDocuments({ documentsDir: home.documentsDir });
  const incompletePaths = discovery.diagnostics.flatMap(function unreadableTree(diagnostic) {
    return diagnostic.code === 'documents-dir-unreadable' || diagnostic.code === 'path-unreadable'
      ? diagnostic.sourcePaths : [];
  });
  const { claimed, diagnostics } = claimSubstrateDocuments({
    homeKey: home.root, documents: discovery.documents, substrates: registry.listSubstrates(),
  });
  const documents: StoredEntityDocument[] = [];
  const quarantines: ClaimQuarantine[] = [];
  const identitiesByType = new Map<string, Set<string>>();
  const maxIds = new Map<string, number>();
  for (const claim of claimed) {
    const identities = identitiesByType.get(claim.type) ?? new Set<string>();
    identities.add(claim.semanticKey);
    identitiesByType.set(claim.type, identities);
    const root = Number.parseInt(claim.storageKey.split('.')[0] ?? '', 10);
    maxIds.set(claim.type, Math.max(maxIds.get(claim.type) ?? 0, root));
    const parsed = parseStoredDocument(claim, registry);
    if (parsed.document !== undefined) documents.push(parsed.document);
    if (parsed.quarantine !== undefined) quarantines.push(parsed.quarantine);
  }
  const byId = new Map<string, StoredEntityDocument>();
  const bySourcePath = new Map<string, StoredEntityDocument>();
  for (const document of documents) {
    byId.set(document.entity.id, document);
    bySourcePath.set(document.sourcePath, document);
  }
  return { documents, quarantines, claimDiagnostics: diagnostics, byId, bySourcePath, identitiesByType, maxIds, incompletePaths };
}
