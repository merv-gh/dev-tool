# Confluence knowledge implementation

The proposal is implemented in an isolated `codex/confluence-knowledge` worktree.

1. Add a read-only Confluence adapter with Server/DC bearer and Cloud basic authentication, bounded pagination, incremental version checks, daily reconciliation and content-addressed attachments. Preserve the previous checkpoint on failures.
2. Parse storage XHTML without evaluating markup or external entities. Keep structural blocks, stable identifiers, heading paths, exact source text and versioned evidence.
3. Index deterministic context with token BM25 and trigram candidate retrieval. Add optional embeddings/RRF and explicitly configured reranking; default search stays offline and extractive.
4. Link known passports, PostgreSQL, Kafka and code endpoints exactly. Keep ambiguous candidates and source provenance. Report missing code support as a gap, not proof that a documented interaction is impossible.
5. Build one architecture model with verified code relations and stated documentation relations. Export Mermaid, C4-PlantUML and Structurizr; support configured local/runner PlantUML or Kroki rendering and an interactive sandboxed viewer.
6. Expose cached page/search/quote verification/feature tools, connect catalog sync and catalog search, document configuration and quoting rules, and extend the mock with a refunds example.
7. Verify parsing, stale versions, pagination, Server/DC and Cloud sync, deletion/moves, attachment reuse, retrieval, graph ambiguity/conflicts, feature evidence, model exports and rendering using deterministic local servers; rebuild `dist/` and run the repository suite.

Optional remote enrichment is disabled by default. Vision and reranking results are labelled inferred and never enter exact textual evidence. Renderer availability is reported explicitly; valid source exports remain usable without a Java/Kroki installation.

API references checked during implementation: [Cloud REST v2 pages](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/), [Cloud REST v2 attachments](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-attachment/), and [Data Center REST](https://developer.atlassian.com/server/confluence/confluence-rest-api-examples/).

## Implemented and checked

All seven implementation steps are complete. The cache also detects attachment-only updates independently of page versions, preserves old citations after deletion/moves, and uses timezone-correct CQL checkpoints. Exact entity matching uses reusable token buckets; index/page reads are cached by file signature and admin counts use a small summary file.

Validation on this branch: `npm test` reports 192 tests, 176 passed, 16 optional/live tests skipped and zero failures. `npm run build:check` confirms generated assets match sources. All four C4/sequence views produced real SVG with official PlantUML 1.2025.10 under Java 24 in SANDBOX mode with bundled C4/Smetana and no Graphviz. Server/DC and Cloud adapters were exercised through real local HTTP mock APIs; no external Confluence tenant credentials were supplied. Optional LLM features were exercised against local OpenAI-compatible mock endpoints.

The browser inspection caught and fixed actual Mermaid 11 HTML-label serialization, SVG label alignment/contrast, literal entity rendering and full-page explicit theme issues. Runtime regressions cover those renderer contracts. Existing screenshot scripts now include the refunds investigation and its chat question.
