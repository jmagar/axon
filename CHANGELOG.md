# Changelog
Last Modified: 2026-02-25

## [Unreleased] — feat/crawl-download-pack

This section documents commits on `feat/crawl-download-pack` relative to `main` (`4777f76`).

### Commit Summary (main..HEAD)

| Commit | Type | Message |
|---|---|---|
| `9ad2e24` | feat(mcp) | align status action parity and refresh docs |
| `6bdfa36` | feat(mcp) | add path-first artifact contract, schema resource, and smoke coverage |
| `2724a2a` | fix | Fix CI failures for websocket v2 tests and cargo-deny config. |
| `54a543b` | chore/fix | Finalize PR feedback fixes and docs updates. |
| `9d5cdd4` | fix(web) | address remaining PR review threads comprehensively |
| `6a02ad3` | feat(web) | refresh pulse UI styling and architecture docs |
| `3863d7c` | fix | address PR API review threads batch 1 |
| `4de7d94` | feat(web) | add omnibox file mentions and root env fallback for pulse APIs |
| `4ac2b46` | fix(web) | resolve pulse UI lint warnings and align renderer changes |
| `241e7ff` | feat(web) | ship Pulse workspace foundation with RAG and copilot API |
| `d15dede` | feat(web) | doctor report renderer, options reorder, result panel polish |
| `1dd74f2` | feat(web) | crawl download routes — pack, zip, and per-file downloads |

### Highlights

#### MCP
- Added MCP artifact contract and schema-resource support (`6bdfa36`).
- Added/updated status action parity work and related docs refresh (`9ad2e24`).

#### Web / Pulse Workspace
- Added Pulse workspace foundation with RAG and copilot API (`241e7ff`).
- Added crawl download routes for pack/zip/per-file downloads (`1dd74f2`).
- Added omnibox file mentions and root env fallback for Pulse APIs (`4de7d94`).
- Applied UI/renderer polish and lint/review follow-up fixes across multiple commits (`d15dede`, `4ac2b46`, `6a02ad3`, `9d5cdd4`).

#### Stability and Review Follow-up
- Fixed CI failures for websocket v2 tests and cargo-deny config (`2724a2a`).
- Landed multiple PR feedback batches and docs updates (`3863d7c`, `54a543b`).

### Notes
- This changelog entry is commit-driven and branch-scoped to avoid stale migration guidance from unrelated historical branches.
- For file-level detail, inspect `git log --name-status main..HEAD`.
