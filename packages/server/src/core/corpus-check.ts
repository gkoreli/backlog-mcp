/** Pure read-only integrity report; discovery and YAML effects are supplied (ADR 0113.4). */
import type { CheckedCorpusEntity, CheckCorpusParams, CorpusCheckDiagnostic, CorpusCheckReport } from './corpus-check.contract.js';
import { parseMarkdownFrontmatter } from './markdown-frontmatter.js';
import { claimSubstrateDocuments } from './substrates/claim-substrate-documents.js';
import { formatStorageDisplayId, matchesStorageDocumentIdentity } from './substrates/storage-identity.js';
import { checkCorpusRelations } from './corpus-check-relations.js';
import { hasCanonicalDocumentMetadata } from './document-canonical-metadata.js';

/** Validate authored documents without creating defaults, identities, titles or writes. */
export function checkCorpus(params: CheckCorpusParams): CorpusCheckReport {
  const diagnostics: CorpusCheckDiagnostic[] = [];
  let complete = true;
  for (const diagnostic of params.discovery.diagnostics) {
    if (['documents-dir-unreadable', 'path-unreadable', 'file-unreadable', 'symlink-outside-documents'].includes(diagnostic.code)) complete = false;
    for (const path of diagnostic.sourcePaths) diagnostics.push({ code: diagnostic.code, severity: 'error', source_path: path, message: diagnostic.message });
  }
  for (const diagnostic of params.registryDiagnostics) {
    const severity = diagnostic.code === 'missing-version-history' ? 'warning' as const : 'error' as const;
    if (severity === 'error') complete = false;
    for (const issue of diagnostic.issues) diagnostics.push({ code: diagnostic.code, severity, source_path: diagnostic.sourcePath, field: issue.path, message: issue.message });
  }
  const substrates = params.registry.listSubstrates();
  const claims = claimSubstrateDocuments({ homeKey: params.homeKey, documents: params.discovery.documents, substrates });
  const byPath = new Map(claims.claimed.map(function path(claim) { return [claim.document.sourcePath, claim]; }));
  const collisions = new Set<string>();
  for (const diagnostic of claims.diagnostics) {
    for (const path of diagnostic.sourcePaths) {
      collisions.add(path);
      diagnostics.push({ code: diagnostic.code, severity: 'error', source_path: path, message: `Duplicate ${diagnostic.type} identity ${diagnostic.semanticKey}; give each document a distinct canonical ID and filename.` });
    }
  }
  const entities: CheckedCorpusEntity[] = [];
  let resources = 0;
  let entityCount = 0;
  for (const document of params.discovery.documents) {
    if (collisions.has(document.sourcePath)) { entityCount += 1; continue; }
    const claimed = byPath.get(document.sourcePath);
    if (claimed !== undefined) entityCount += 1;
    else resources += 1;
    if (document.content === undefined) {
      complete = false;
      if (!diagnostics.some(function unreadable(diagnostic) { return diagnostic.code === 'file-unreadable' && diagnostic.source_path === document.sourcePath; })) diagnostics.push({ code: 'file-unreadable', severity: 'error', source_path: document.sourcePath, message: 'Document bytes are unavailable; restore readable access and rerun the complete check.' });
      continue;
    }
    if (document.format !== 'markdown') {
      if (claimed !== undefined) diagnostics.push({ code: 'non-markdown-entity', severity: 'error', source_path: document.sourcePath, message: 'Managed entities must use Markdown documents.' });
      continue;
    }
    let parsed;
    try { parsed = parseMarkdownFrontmatter(document.content, params.yaml); }
    catch (error) {
      if (!params.discovery.diagnostics.some(function alreadyReported(diagnostic) { return diagnostic.code === 'malformed-frontmatter' && diagnostic.sourcePaths.includes(document.sourcePath); })) {
        diagnostics.push({ code: 'malformed-frontmatter', severity: 'error', source_path: document.sourcePath, message: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    if (claimed === undefined) {
      const typed = Object.hasOwn(parsed.data, 'id') || Object.hasOwn(parsed.data, 'type');
      const underClaim = substrates.some(function contains(substrate) { return document.sourcePath.startsWith(`${substrate.storageClaim.folder}/`); });
      if (typed || (document.identity.pathKey !== undefined && underClaim)) {
        entityCount += 1;
        resources -= 1;
        diagnostics.push({ code: 'unclaimed-entity', severity: 'error', source_path: document.sourcePath, message: 'Entity metadata or numbered filename has no matching substrate claim; align its folder and filename with a declared substrate.' });
      }
      else if (document.identity.pathKey !== undefined) diagnostics.push({ code: 'unclaimed-numbered-document', severity: 'warning', source_path: document.sourcePath, message: 'Numbered document is a resource, not a registered entity; declare a substrate to give it entity operations.' });
      continue;
    }
    const claim = params.registry.getStorageClaim(claimed.type);
    if (claim === undefined) { complete = false; continue; }
    const id = formatStorageDisplayId(claim, claimed.storageKey);
    const base = { severity: 'error' as const, source_path: document.sourcePath, entity_id: id };
    if (!parsed.hasFrontmatter) diagnostics.push({ ...base, code: 'missing-frontmatter', message: 'Entity documents need authored YAML frontmatter; add the canonical id, type, title and required substrate fields.' });
    if (parsed.data.id !== id || !matchesStorageDocumentIdentity(claim, String(parsed.data.id), document.identity)) diagnostics.push({ ...base, code: 'identity-mismatch', field: '/id', message: `Frontmatter id must be ${id}, matching the canonical filename identity.` });
    if (parsed.data.type !== claimed.type) diagnostics.push({ ...base, code: 'type-mismatch', field: '/type', message: `Frontmatter type must be ${claimed.type}, matching this folder's substrate claim.` });
    const candidate = { ...parsed.data, content: parsed.content };
    const owner = substrates.find(function ownsClaim(substrate) { return substrate.storageClaim.type === claimed.type; });
    const validation = owner === undefined ? params.registry.validateWrite(candidate) : owner.validateWrite(candidate);
    if (!validation.ok) {
      for (const issue of validation.issues) diagnostics.push({ ...base, code: 'schema-invalid', field: issue.path, message: issue.message });
    } else if (!hasCanonicalDocumentMetadata(parsed.data, validation.entity)) {
      diagnostics.push({ ...base, code: 'schema-normalization-required', message: 'Managed schema parsing would change authored fields; explicitly record its defaults and normalized values instead of relying on read-time fabrication.' });
    }
    // A claim identifies the document even when its authored metadata is invalid.
    entities.push({ id, type: claimed.type, source_path: document.sourcePath, data: candidate });
    if (claimed.type === 'adr' && (typeof parsed.data.description !== 'string' || parsed.data.description.trim() === '')) diagnostics.push({ ...base, severity: 'warning', code: 'missing-description', field: '/description', message: 'Add a short authored ADR discovery description, targeting roughly 50 tokens.' });
  }
  diagnostics.push(...checkCorpusRelations(entities, params));
  diagnostics.sort(function order(left, right) { return left.source_path.localeCompare(right.source_path) || left.code.localeCompare(right.code) || (left.field ?? '').localeCompare(right.field ?? '') || left.message.localeCompare(right.message); });
  const errors = diagnostics.filter(function error(diagnostic) { return diagnostic.severity === 'error'; }).length;
  const warnings = diagnostics.length - errors;
  return { version: 1, complete, valid: complete && errors === 0, summary: { documents: params.discovery.documents.length, entities: entityCount, resources, errors, warnings }, diagnostics };
}
