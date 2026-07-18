import type { Tokenizer } from '@orama/orama';
import { tokenizer as defaultTokenizerComponent } from '@orama/orama/components';
import { stopwords as englishStopwords } from '@orama/stopwords/english';

/**
 * Split a word on camelCase/PascalCase boundaries.
 * "FeatureStore" → ["Feature", "Store"]
 * "getHTTPResponse" → ["get", "HTTP", "Response"]
 * "simple" → ["simple"] (no split)
 */
export function splitCamelCase(word: string): string[] {
  // Insert boundary marker between lowercase→uppercase and acronym→word transitions
  return word
    .replace(/([a-z\d])([A-Z])/g, '$1\0$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\0$2')
    .split('\0')
    .filter(Boolean);
}

/**
 * Expand compound words (hyphens + camelCase) into extra space-separated
 * surface forms, ahead of real tokenization.
 * "FeatureStore" → "FeatureStore Feature Store"
 * "keyboard-first" → "keyboard-first keyboard first"
 *
 * This is surface expansion only — no lowercasing, stemming, stop-word
 * removal, or dedup. Those all happen once, uniformly, inside the composed
 * base tokenizer's `tokenize()` (see `compoundWordTokenizer` below), so a
 * compound word's parts go through exactly the same normalization as any
 * other token instead of duplicating that logic here.
 */
function expandCompoundWords(input: string): string {
  // Split on non-alphanumeric (keeping hyphens/apostrophes) BEFORE lowercasing
  const rawTokens = input.split(/[^a-zA-Z0-9'-]+/).filter(Boolean);
  const expanded: string[] = [];
  for (const raw of rawTokens) {
    expanded.push(raw);
    // Expand hyphens: "keyboard-first" → + ["keyboard", "first"]
    if (raw.includes('-')) {
      expanded.push(...raw.split(/-+/).filter(Boolean));
    }
    // Expand camelCase: "FeatureStore" → + ["Feature", "Store"]
    const camelParts = splitCamelCase(raw);
    if (camelParts.length > 1) {
      expanded.push(...camelParts);
    }
  }
  return expanded.join(' ');
}

/**
 * Compound-word tokenizer — composes over Orama's real default tokenizer
 * instead of replacing it (REF-0016 "compose, don't replace").
 *
 * `create()` takes any object with a `.tokenize` method AS-IS (see
 * `methods/create.ts`), which means supplying a bare custom tokenizer
 * bypasses Orama's own `createTokenizer()` pipeline entirely — no stemming,
 * no stop-word removal, ever. That was this file's bug: a previous version
 * hand-rolled camelCase/hyphen splitting as the *entire* tokenizer, silently
 * losing both. The fix builds on the real default tokenizer (English Porter
 * stemmer + the official `@orama/stopwords` list) and wraps only `.tokenize`
 * to expand compound words first, delegating actual tokenization —
 * lowercasing, stop-word removal, stemming, diacritics, dedup — to it.
 *
 * `createTokenizer` is synchronous in `@orama/orama@3.1.18` (verified
 * directly against the installed source — a plain function returning an
 * object, no Promise involved), so this composes once at module load; no
 * async factory/init is needed to wire it into `createOramaInstance`.
 */
const base = defaultTokenizerComponent.createTokenizer({
  language: 'english',
  stemming: true,
  stopWords: englishStopwords,
});

export const compoundWordTokenizer: Tokenizer = {
  ...base,
  tokenize(raw: string, language?: string, prop?: string, withCache?: boolean): string[] {
    if (typeof raw !== 'string') return [];
    return base.tokenize(expandCompoundWords(raw), language, prop, withCache);
  },
};
