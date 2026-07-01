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
- `cffeba714`

Self-review notes
- Kept the work inside `axon-retrieval` plus the required manifest/lockfile refresh.
- Added only boundary DTOs/helpers and a minimal generic retrieval engine over `EmbeddingProvider` + `VectorStore`; no CLI/MCP/REST/runtime cutover.
- Preserved request source/generation/visibility/namespace inputs in `RetrievalPlan`, used deterministic fake providers/stores for ranking, enforced aggregate context budgets, and required citation identity/range fields from vector matches.

Concerns
- The fake engine currently maps namespace filters to the first `vector_namespace` string for compatibility with the existing fake vector store payload matcher; full multi-namespace retrieval semantics are intentionally deferred to the later cutover work.
- This report is updated to the final HEAD hash after commit; re-amending it would change the hash again, so the worktree now differs only at this self-referential report file.

---

Review-fix appendix
- Scope: review findings against `crates/axon-retrieval` only; no runtime cutover and no `axon-vector` edits.

Red checks run first
- `cargo test -p axon-retrieval --locked context_assembly_counts_separator_bytes_against_budget`
  - Failed as expected: the bundle accepted `chunk-b` even though joining `chunk-a` and `chunk-b` with `"\n\n"` would exceed the byte budget.
- `cargo test -p axon-retrieval --locked citation_from_vector_match_rejects_missing_range_locator`
  - Failed as expected: `Citation::from_vector_match` returned a citation whose `SourceRange` had every locator field unset.

Fixes applied
- `crates/axon-retrieval/src/context.rs`
  - Counted separator bytes during incremental context assembly so accepted chunks fit the actual joined text budget.
- `crates/axon-retrieval/src/citation.rs`
  - Parsed the full set of source-range locator payload fields and rejected vector matches that provide no real locator.
- `crates/axon-retrieval/src/engine_tests.rs`
  - Added regression coverage for separator-inclusive context budgeting and locator-less citation rejection.

Green re-checks after implementation
- `cargo test -p axon-retrieval --locked context_assembly_counts_separator_bytes_against_budget`
- `cargo test -p axon-retrieval --locked citation_from_vector_match_rejects_missing_range_locator`
