# Implementation Ready

- [x] ADR created at `docs/adr/0081-independent-retrievers-linear-fusion.md`
- [x] ADR log updated at `docs/adr/README.md`
- [x] Re-read the ADR
- [x] Re-read the task requirements (TASK-0302)
- [x] Understand the implementation approach

<implementationplan>
1. Extract `tokenizer.ts` — move splitCamelCase + compoundWordTokenizer (pure, zero deps)
2. Extract `snippets.ts` — move snippet generation functions (pure, zero deps)
3. Extract `orama-schema.ts` — move types, schema, constants, buildWhereClause
4. Create `scoring.ts` — minmaxNormalize, linearFusion, applyPostFusionModifiers (new code)
5. Slim `orama-search-service.ts` — import from new modules, replace _executeSearch with _executeBM25Search + _executeVectorSearch, replace rerankWithSignals calls with scoring.linearFusion, delete old scoring functions
6. Update `index.ts` re-exports
7. Run tests — all 749 must pass
8. Build — clean tsc + pnpm build
</implementationplan>

<firststep>Extract tokenizer.ts — smallest, most isolated extraction. Proves the module boundary pattern works before touching scoring.</firststep>
