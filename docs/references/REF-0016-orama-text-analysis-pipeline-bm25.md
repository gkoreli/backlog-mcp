---
title: "REF-0016 — Orama v3 Text-Analysis Pipeline & BM25 (why our custom tokenizer silently dropped stop-words + stemming)"
date: 2026-07-18
status: Captured
author: granite
source_url: https://docs.orama.com/docs/orama-js/internals/components#tokenizer
verification: >-
  source-verified at @orama/orama git tag v3.1.18 (backlog-mcp's pinned
  version); every docs claim cross-checked against the pinned source and
  diffed against v3.2.0 (no behavioral change in tokenizer wiring or BM25);
  two independent research passes converged on the same findings
relates_to:
  - ../adr/0121-retrieval-evaluation-from-first-principles.md
  - ../evaluation/R8-JUDGING-2026-07-18.md
  - ./REF-0015-cerebras-enterprise-knowledge-base.md
---

# REF-0016 — Orama v3 Text-Analysis Pipeline & BM25

**Why this exists.** R8 human recall grading surfaced irrelevant memories
ranking high. Diagnosis traced it partly to our search index having **no
stop-word removal and no stemming**. This reference captures — from Orama's
*authoritative* docs and source, pinned to our installed `@orama/orama@3.1.18`
— exactly what Orama provides, why we lost it, and the documented fix, so we
compose the library's pipeline instead of hand-rolling English word lists.
(Grounding note: prior investigation read `node_modules` — compiled output —
which is not authoritative; every citation below is a specific docs page or a
`v3.1.18`-tagged source file.)

## Canonical sources (verified, not assumed)

- **GitHub org is `oramasearch`.** `github.com/askorama/orama` → HTTP 301 →
  `github.com/oramasearch/orama` (`askorama` is the old org name). Use
  `oramasearch` in all links.
- **Docs domain is `docs.orama.com`.** `docs.oramasearch.com` is dead (DNS
  ENOTFOUND); `docs.askorama.ai` mirrors but isn't the canonical target.
  `orama.com/blog/*` currently returns 404 — **excluded**, do not cite.
- **Version.** The "Orama JS" docs are unversioned; every claim here was
  cross-checked against source at tag `v3.1.18` (our pinned version) and
  diffed against `v3.2.0` — no tokenizer/BM25 behavior change in that range.

## The root cause — a custom tokenizer REPLACES the whole pipeline

**Source (ground truth):** [`create.ts` @ v3.1.18](https://github.com/oramasearch/orama/blob/v3.1.18/packages/orama/src/methods/create.ts)

```js
let tokenizer = components.tokenizer
if (!tokenizer) {
  tokenizer = createTokenizer({ language: language ?? 'english' })   // (1) default
} else if (!(tokenizer as Tokenizer).tokenize) {
  tokenizer = createTokenizer(tokenizer)                             // (2) config object → full pipeline
} else {
  tokenizer = tokenizer as Tokenizer                                // (3) has .tokenize → used AS-IS
}
if (components.tokenizer && language) throw createError('NO_LANGUAGE_WITH_CUSTOM_TOKENIZER')
```

**Why it matters (this is our bug):** our `packages/memory/src/search/tokenizer.ts`
`compoundWordTokenizer` is a bare object with a `.tokenize` function, so
`create()` takes **branch 3** and uses it verbatim — `createTokenizer()` (which
wires `stemmer` + `stopWords` + `normalizeToken`) is **never called**. No
stemmer and no stop-word list have *ever* been active in this index. Orama has
no implicit merge step; supplying `.tokenize` opts out of the entire default
pipeline. Confirmed independently by two research passes against the same
source path.

**Docs corroboration:** [Components §tokenizer](https://docs.orama.com/docs/orama-js/internals/components#tokenizer)
— *"When no components are specified… defaults… English tokenizer with
**stemming disabled**."* The docs' own minimal custom-tokenizer example
(`tokenize(raw){ return raw[0] }`) carries no stemmer/stopWords fields —
demonstrating replacement, not extension.

**Contract** ([`types.ts` L1087–1106 @ v3.1.18](https://github.com/oramasearch/orama/blob/v3.1.18/packages/orama/src/types.ts)):
`DefaultTokenizerConfig` (Orama wires it via `createTokenizer()`) vs. the
finished `Tokenizer` interface (`language`, `normalizationCache`, `tokenize`) —
`create()` distinguishes them *only* by presence of `.tokenize`.

## Stop-words

- **Docs:** [text-analysis/stop-words §enabling](https://docs.orama.com/docs/orama-js/text-analysis/stop-words#enabling-stop-words-removal)
  — *"By default, Orama does not remove any stop-word… explicit action from the
  user."* Enable via `components.tokenizer.stopWords`.
- **Official list, don't hand-roll:** [§using-the-default-stop-words-list](https://docs.orama.com/docs/orama-js/text-analysis/stop-words#using-the-default-stop-words-list)
  — `import { stopwords as englishStopwords } from "@orama/stopwords/english"`;
  *"the recommended way."* The English list is **155 words**
  ([`packages/stopwords/lib/en.js` @ v3.1.18](https://github.com/oramasearch/orama/blob/v3.1.18/packages/stopwords/lib/en.js)).
- **Type:** `stopWords?: boolean | string[] | ((stopWords: string[]) => string[])`.
  `false` disables; array is used verbatim; a function receives the internal
  array (always `[]`). **`stopWords: true` throws** `CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY`
  (source-only nuance, not in prose docs). Core ships **no** embedded list —
  `@orama/stopwords` is opt-in.
- **Gotcha:** the single-letter article **"a" is absent** from the official
  English list (only "an"/"the"). Relevant since our band-aid list included "a".

## Stemming (we're missing this too — arguably the bigger recall loss)

- **Docs:** [text-analysis/stemming](https://docs.orama.com/docs/orama-js/text-analysis/stemming)
  — English Porter stemmer **ships in `@orama/orama` core**; `stemming: true`
  alone suffices for English (no extra install). Non-English needs
  `@orama/stemmers` (28 language subpaths at v3.1.18).
- **Why it matters:** without stemming, `"release"` doesn't match `"releases"`,
  `"landing"` doesn't match `"land"`, `"merge"` doesn't match `"merging"` — a
  silent recall gap on top of the stop-word gap, from the same tokenizer swap.

## The documented fix — compose, don't replace

The public [`@orama/orama/components`](https://docs.orama.com/docs/orama-js/internals/components#tokenizer)
export exposes `createTokenizer()`; the docs show the "spread the default,
override one method" pattern for every swappable component (`index`,
`documentsStore`, `sorter`). Applied to the tokenizer:

```js
import { tokenizer as defaultTokenizer } from "@orama/orama/components";
import { stopwords as englishStopwords } from "@orama/stopwords/english";

const base = await defaultTokenizer.createTokenizer({
  language: "english", stemming: true, stopWords: englishStopwords,
});
const compoundTokenizer = {
  ...base,
  tokenize(raw, language, prop, withCache) {
    return base.tokenize(expandCompoundWords(raw), language, prop, withCache);
  },
};
create({ schema, components: { tokenizer: compoundTokenizer } });
```

Compound-word splitting is preserved; stop-words + stemming + diacritics +
dedupe run inside `base.tokenize`. This deletes our hand-rolled stop-word list
and makes the coordination re-ranker inherit the fix for free (it tokenizes via
the same function).

## BM25 (Orama uses BM25+, and its IDF never goes negative)

- **Docs:** [search/bm25](https://docs.orama.com/docs/orama-js/search/bm25) —
  tune via `search(..., { relevance: { k, b, d } })`. Defaults `k:1.2, b:0.75,
  d:0.5`. No official small-corpus guidance.
- **Formula** ([`algorithms.ts` @ v3.1.18](https://github.com/oramasearch/orama/blob/v3.1.18/packages/orama/src/components/algorithms.ts)):
  `idf = log(1 + (N - df + 0.5)/(df + 0.5))`. The `1 +` guard means **IDF is
  always ≥ 0** — a term in *every* document still scores slightly positive
  (unlike classic BM25, which can go negative). The `d` numerator term is the
  BM25+ delta (Lv & Zhai) protecting long docs. *Why it matters:* IDF alone
  will **not** zero out stop-words here — another reason stop-word removal must
  happen at tokenization, not be left to IDF.
- **Per-field weighting** is a separate `boost: { field: n }` search param
  ([fields-boosting](https://docs.orama.com/docs/orama-js/search/fields-boosting)),
  orthogonal to `k/b/d`.

## No analyzer plugin exists

[Plugins index](https://docs.orama.com/docs/orama-js/plugins): the 12 official
plugins are none about tokenization/stemming/stop-words — text analysis is
delivered via `components.tokenizer` + the standalone `@orama/stemmers`,
`@orama/stopwords`, `@orama/tokenizers` packages. (`plugin-qps` / `plugin-pt15`
*replace* BM25 entirely; not tuning aids.) Don't look for an analyzer plugin.

## Flagged docs↔package inconsistencies (verify before relying)

1. **Vietnamese stemmer** is listed in docs but has no `./vietnamese` subpath in
   `@orama/stemmers@3.1.18` `exports`; ditto no `./czech`/`./slovenian` despite
   core listing them as valid `language` values. Check `packages/stemmers/package.json`
   `exports` directly before going multilingual.
2. **README typo:** `packages/stopwords/README.md` shows `stopwords:` (lowercase
   w); the real property is `stopWords` — a copy-paste silently no-ops.
3. Core's language code for Hindi is `indian`, not `hindi`.

## What this means for backlog-mcp

We lost stop-words **and** stemming the moment we set a custom `.tokenize`
(branch 3 above) — never active in any index. The fix is the documented
composition pattern (`@orama/stopwords/english` + `stemming: true` layered under
our compound splitter), which supersedes the hand-rolled coordination-bonus
stop-word list, requires an `INDEX_VERSION` bump (tokenizer change ⇒ reindex),
and must be measured against `recall-qrels-v2` before landing.
