import { describe, expect, it } from 'vitest';
import { slugifyDocumentTitle } from '../core/document-slug.js';

describe('slugifyDocumentTitle (ADR 0129 R3)', function describeSlug() {
  it('lowercases, hyphenates runs of punctuation and whitespace, and trims edges', function normalizesPunctuation() {
    expect(slugifyDocumentTitle('  Focus is never-yield — by CONSTRUCTION!  '))
      .toBe('focus-is-never-yield-by-construction');
    expect(slugifyDocumentTitle('Personal Mac global backlog CLI link'))
      .toBe('personal-mac-global-backlog-cli-link');
  });

  it('strips diacritics to ASCII', function stripsDiacritics() {
    expect(slugifyDocumentTitle('Café Ünïcode naïve résumé'))
      .toBe('cafe-unicode-naive-resume');
  });

  it('returns undefined when nothing slug-worthy survives', function returnsUndefinedForEmpty() {
    expect(slugifyDocumentTitle('')).toBeUndefined();
    expect(slugifyDocumentTitle('!!! --- ???')).toBeUndefined();
    expect(slugifyDocumentTitle('ცა')).toBeUndefined();
  });

  it('caps at 60 characters on a word boundary', function capsAtBoundary() {
    const long = 'Focus is never-yield by construction — lines added to it are free of trim logic but cost permanent bytes';
    const slug = slugifyDocumentTitle(long);
    expect(slug).toBe('focus-is-never-yield-by-construction-lines-added-to-it-are');
    expect(slug?.length).toBeLessThanOrEqual(60);
    expect(slug?.endsWith('-')).toBe(false);
  });

  it('hard-cuts a single word longer than the cap', function cutsLongWord() {
    const slug = slugifyDocumentTitle('a'.repeat(80));
    expect(slug).toBe('a'.repeat(60));
  });

  it('is idempotent over its own output', function isIdempotent() {
    const once = slugifyDocumentTitle('Request identity follows the selected runtime');
    expect(once).toBeDefined();
    expect(slugifyDocumentTitle(once ?? '')).toBe(once);
  });
});
