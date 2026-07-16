import { posix } from 'node:path';
import type {
  DocumentIdentity,
  ParseDocumentIdentityParams,
} from './document-identity.types.js';

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/iu;
const DATE_PREFIXED_FILENAME = /^\d{4}-\d{2}-\d{2}(?!\d)/u;
const NUMBERED_FILENAME = /^(\d+(?:\.\d+)*)(?:-(.*))?$/u;
const PREFIXED_NUMBER_FILENAME = /^([A-Za-z][A-Za-z0-9]*)-(\d+(?:\.\d+)*)(?:-(.*))?$/u;

interface ParsedPathIdentity {
  pathKey: string;
  slug?: string;
  threadRootKey?: string;
  threadParentKey?: string;
}

/** Normalize a document source path to stable POSIX separators and segments. */
export function normalizeDocumentSourcePath(sourcePath: string): string {
  const withPosixSeparators = sourcePath.replaceAll('\\', '/');
  return withPosixSeparators ? posix.normalize(withPosixSeparators) : '';
}

function deriveThreadIdentity(
  pathKey: string,
): Pick<ParsedPathIdentity, 'threadRootKey' | 'threadParentKey'> {
  const segments = pathKey.split('.');
  if (segments.length < 2) return {};

  const threadRootKey = segments[0];
  if (!threadRootKey) return {};

  return {
    threadRootKey,
    threadParentKey: segments.slice(0, -1).join('.'),
  };
}

function createParsedPathIdentity(pathKey: string, rawSlug?: string): ParsedPathIdentity {
  const identity: ParsedPathIdentity = {
    pathKey,
    ...deriveThreadIdentity(pathKey),
  };
  if (rawSlug?.trim()) identity.slug = rawSlug;
  return identity;
}

function parseFilename(sourcePath: string): ParsedPathIdentity | undefined {
  const filename = posix.basename(sourcePath);
  if (!MARKDOWN_EXTENSION.test(filename)) return undefined;

  const stem = filename.replace(MARKDOWN_EXTENSION, '');
  if (DATE_PREFIXED_FILENAME.test(stem)) return undefined;

  const prefixedMatch = PREFIXED_NUMBER_FILENAME.exec(stem);
  const prefix = prefixedMatch?.[1];
  const prefixedNumber = prefixedMatch?.[2];
  const prefixedSlug = prefixedMatch?.[3];
  if (prefix && prefixedNumber) {
    return createParsedPathIdentity(`${prefix}-${prefixedNumber}`, prefixedSlug);
  }

  const numberedMatch = NUMBERED_FILENAME.exec(stem);
  const number = numberedMatch?.[1];
  const numberedSlug = numberedMatch?.[2];
  if (number) {
    return createParsedPathIdentity(number, numberedSlug);
  }

  return undefined;
}

function cleanDeclaredId(declaredId: unknown): string | undefined {
  if (typeof declaredId !== 'string') return undefined;
  const trimmed = declaredId.trim();
  return trimmed || undefined;
}

/**
 * Parse substrate-neutral identity and provenance from one discovered document.
 *
 * Semantic validation, including declared/path ID agreement, belongs to the
 * compiled substrate definition rather than this physical filename parser.
 */
export function parseDocumentIdentity(
  params: ParseDocumentIdentityParams,
): DocumentIdentity {
  const sourcePath = normalizeDocumentSourcePath(params.sourcePath);
  const identity: DocumentIdentity = { sourcePath };
  const parsedPath = parseFilename(sourcePath);
  const declaredId = cleanDeclaredId(params.declaredId);

  if (parsedPath) {
    identity.pathKey = parsedPath.pathKey;
    if (parsedPath.slug) identity.slug = parsedPath.slug;
    if (parsedPath.threadRootKey) identity.threadRootKey = parsedPath.threadRootKey;
    if (parsedPath.threadParentKey) identity.threadParentKey = parsedPath.threadParentKey;
  }
  if (declaredId) identity.declaredId = declaredId;
  if (params.observedDate !== undefined) identity.observedDate = params.observedDate;
  if (params.dateSource !== undefined) identity.dateSource = params.dateSource;

  return identity;
}
