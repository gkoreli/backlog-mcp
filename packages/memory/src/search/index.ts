// Types
export type { SearchService, SearchOptions, SearchFilters, SearchResult, UnifiedSearchResult, SearchSnippet, Resource, ResourceSearchResult, SearchableType } from './types.js';

// Orama implementation
export { OramaSearchService, type OramaSearchOptions } from './orama-search-service.js';

// Orama schema + helpers
export { schema, schemaWithEmbeddings, INDEX_VERSION, TEXT_PROPERTIES, UNSORTABLE_PROPERTIES, ENUM_FACETS, buildWhereClause, type OramaDoc, type OramaDocWithEmbeddings, type OramaInstance, type OramaInstanceWithEmbeddings } from './orama-schema.js';

// Embeddings
export { EmbeddingService, EMBEDDING_DIMENSIONS } from './embedding-service.js';

// Snippets
export { generateTaskSnippet, generateResourceSnippet } from './snippets.js';

// Scoring
export { minmaxNormalize, rankNormalize, linearFusion, applyCoordinationBonus, applyTemporalDecay, applyExactTitlePin, DEFAULT_WEIGHTS, DEFAULT_HALF_LIFE_DAYS, TITLE_PIN_BONUS, type ScoredHit } from './scoring.js';

// Judged-relevance evaluation (ADR 0116)
export {
  evaluateQuery,
  ndcgAt,
  recallAt,
  reciprocalRank,
  successAt1,
  summarizeEvaluations,
  type EvaluationSummary,
  type QueryEvaluation,
  type RelevanceGrade,
  type RelevanceJudgment,
} from './evaluation.js';

// Tokenizer
export { compoundWordTokenizer, splitCamelCase } from './tokenizer.js';
// Query intent parser (ADR 0083 #4)
export { parseQueryIntent, canonicalizeIdQuery, extractLeadingFilters, type QueryIntent } from './query-intent.js';
