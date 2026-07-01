Red command + expected failure
- `cargo test -p axon-retrieval --locked`
- Expected red result: `axon-retrieval` had no direct boundary deps or retrieval DTO/engine types wired yet, so the new tests failed to compile against unresolved imports and missing retrieval boundary surface.

Green command(s)
- `cargo test -p axon-retrieval`
- `cargo test -p axon-retrieval --locked`

Files changed
- `Cargo.lock`
- `crates/axon-retrieval/Cargo.toml`
- `crates/axon-retrieval/src/lib.rs`
- `crates/axon-retrieval/src/engine.rs`
- `crates/axon-retrieval/src/plan.rs`
- `crates/axon-retrieval/src/query.rs`
- `crates/axon-retrieval/src/context.rs`
- `crates/axon-retrieval/src/citation.rs`
- `crates/axon-retrieval/src/testing.rs`
- `crates/axon-retrieval/src/engine_tests.rs`

Commit hash
- `364e1d215`

Self-review notes
- Kept the work inside `axon-retrieval` plus the required manifest/lockfile refresh.
- Added only boundary DTOs/helpers and a minimal generic retrieval engine over `EmbeddingProvider` + `VectorStore`; no CLI/MCP/REST/runtime cutover.
- Preserved request source/generation/visibility/namespace inputs in `RetrievalPlan`, used deterministic fake providers/stores for ranking, enforced aggregate context budgets, and required citation identity/range fields from vector matches.

Concerns
- The fake engine currently maps namespace filters to the first `vector_namespace` string for compatibility with the existing fake vector store payload matcher; full multi-namespace retrieval semantics are intentionally deferred to the later cutover work.
