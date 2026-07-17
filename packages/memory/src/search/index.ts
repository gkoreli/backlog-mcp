// Types
export type {
  IndexableEntity,
  Resource,
  ResourceSearchResult,
  SearchEntityDocument,
  SearchEntityField,
  SearchFilters,
  SearchOptions,
  SearchResult,
  SearchService,
  SearchSnippet,
  SearchableType,
  UnifiedSearchResult,
} from './types.js';

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

// Tokenizer
export { compoundWordTokenizer, splitCamelCase } from './tokenizer.js';
// Query intent parser (ADR 0083 #4; registry-derived ID intent per ADR 0121 R9)
export {
  parseQueryIntent,
  canonicalizeIdQuery,
  extractLeadingFilters,
  idIntentSpecsFromIdentities,
  BUILTIN_ID_INTENT_SPECS,
  type QueryIntent,
  type IdentityDeclaration,
  type IdIntentSpec,
} from './query-intent.js';

// Cross-home rank fusion (ADR 0112.1 / ADR 0116)
export { mergeCrossHomeRrf, RRF_K } from './cross-home-rrf.js';
export type { CrossHomeRankedList, CrossHomeRrfResult } from './cross-home-rrf.types.js';
