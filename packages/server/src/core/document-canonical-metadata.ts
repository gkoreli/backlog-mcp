/** Adoption policy compares authored metadata with the active schema's complete shape (ADR 0113.4 R5). */
import { isDeepStrictEqual } from 'node:util';

/** Formatting never requires adoption; added, removed or transformed metadata does. */
export function hasCanonicalDocumentMetadata(authored: Readonly<Record<string, unknown>>, validatedEntity: Readonly<Record<string, unknown>>): boolean {
  const { content: _content, ...canonicalMetadata } = validatedEntity;
  return isDeepStrictEqual(authored, canonicalMetadata);
}
