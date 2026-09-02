/**
 * Filename slug derivation for engine-created documents (ADR 0129 R3).
 *
 * The slug is a human affordance appended to the filename
 * (`MEMO-0010-<slug>.md`); it never participates in identity, uniqueness,
 * lookup, or link resolution (ADR 0129 R1). It is frozen at creation and
 * never re-derived on title edits (R4).
 */

const MAX_SLUG_LENGTH = 60;
const COMBINING_MARKS = /\p{M}+/gu;
const NON_ALPHANUMERIC_RUN = /[^a-z0-9]+/gu;
const EDGE_HYPHENS = /^-+|-+$/gu;

function truncateAtWordBoundary(slug: string): string {
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  const window = slug.slice(0, MAX_SLUG_LENGTH + 1);
  const boundary = window.lastIndexOf('-');
  return boundary > 0 ? window.slice(0, boundary) : slug.slice(0, MAX_SLUG_LENGTH);
}

/**
 * Derive a deterministic, ASCII, bounded filename slug from a document title.
 *
 * Returns `undefined` when nothing slug-worthy survives (symbol-only or
 * non-Latin titles); callers then write the bare `<pathKey>.md`, which is a
 * valid outcome rather than an error.
 */
export function slugifyDocumentTitle(title: string): string | undefined {
  const slug = title
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_RUN, '-')
    .replace(EDGE_HYPHENS, '');
  const bounded = truncateAtWordBoundary(slug).replace(EDGE_HYPHENS, '');
  return bounded === '' ? undefined : bounded;
}
