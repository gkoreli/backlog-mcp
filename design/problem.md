# Problem Articulation: CamelCase Compound Word Search

## The Problem in One Sentence

The search tokenizer destroys camelCase word boundaries by lowercasing before splitting, making compound words like "FeatureStore" unsearchable by their component words "feature" and "store".

## Who Is Affected

Every user searching for content that contains PascalCase/camelCase identifiers — extremely common in a software engineering backlog (package names, class names, feature flags, MFE IDs).

## Why It Matters

Search is the primary discovery mechanism. When a user knows a task exists and types obvious keywords that appear in the content, getting zero results destroys trust in the search system. This is a fundamental tokenization gap, not a ranking issue.

## Success Criteria

1. `"feature store"` → finds TASK-0273 (contains "FeatureStore")
2. `"featurestore"` → still finds TASK-0273 (exact compound match preserved)
3. `"FeatureStore"` → still finds TASK-0273 (case-insensitive)
4. Existing hyphen expansion unchanged: `"keyboard-first"` → `["keyboard-first", "keyboard", "first"]`
5. All existing search tests pass without modification
6. Index cache invalidation handled (stale indexes rebuilt)
