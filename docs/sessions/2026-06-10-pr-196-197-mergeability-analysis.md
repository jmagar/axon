---
date: 2026-06-10 07:02:23 EST
repo: git@github.com:jmagar/axon.git
branch: feat/qdrant-affinity-tei-burst
head: b1436727
working directory: /home/jmagar/workspace/axon/.worktrees/affinity
worktree: /home/jmagar/workspace/axon/.worktrees/affinity
pr: "#197 feat: embed-job fs-namespace claim affinity + doctor TEI concurrency drift warning — https://github.com/jmagar/axon/pull/197 (analysis also covers #196 — https://github.com/jmagar/axon/pull/196)"
beads: axon_rust-8x8w
---

# PR #196 / #197 mergeability analysis — collapse plan

> Continuation of the same conversation session documented in
> [`2026-06-09-code-review-remediation-embed-pipeline-qdrant-ops.md`](2026-06-09-code-review-remediation-embed-pipeline-qdrant-ops.md)
> (the four-PR review remediation, embed-pipeline debugging, and Qdrant ops work).
> This artifact covers only the morning's new work: determining what it takes to
> make the two open PRs mergeable given the concurrent-session overlap.

## User Request

"So what are we going to have to do with that branch exactly to make it mergeable" — followed by "or this one": assess mergeability of both `fix/code-review-findings-185-192` (PR #196) and `feat/qdrant-affinity-tei-burst` (PR #197).

## Session Overview

Measured the actual divergence between the two PR branches and discovered the concurrent session's 18 commits on the fix branch **absorbed nearly everything on the feat branch** — including a byte-identical copy of migration 0008, the fs-namespace affinity code, the doctor TEI drift warning, and the `AXON_FS_NAMESPACE` compose env — and deliberately reverted the premature audit relocation that the feat branch still carries. Only four commits on #197 remain unique (two compose hardening commits, the `router()` split, the session log). Verified PR #196 merges **clean into main** via `git merge-tree --write-tree`. Produced and bead-tracked a collapse plan: cherry-pick the four unique commits onto the fix branch, close #197 as superseded, merge #196 alone.

## Sequence of Events

1. **Fetched and mapped branch state**: fix branch was ahead 18 locally at analysis start (tip `2be496f2`, v5.7.5); by the end of the analysis the concurrent session had pushed it (origin now `887d7c4f`). feat branch synced at `b1436727`.
2. **Read the 18 fix-branch commits**: spotted `e613e4d1` ("multi-lane RAG hardening + **embed fs_namespace affinity** + palette docs, v5.7.0" — 102 files, +4,322/−1,317) and `3a2e52ea` ("revert premature pub mod audit in crawl.rs; audit relocation not ready").
3. **Compared the overlapping work**: `git diff fix..feat -- src/jobs/migrations/` is empty (migration 0008 byte-identical); `git grep fs_namespace` on fix hits `ops/enqueue.rs`, `ops/lifecycle.rs`, the migration; `tei_concurrency_warning` present via `src/core/health/doctor/sqlite_tests.rs`; `AXON_FS_NAMESPACE` present in fix's compose.
4. **Identified what fix is missing**: `oom_score_adj: -500`, `cpus: '8.0'` (still `'4.0'`), and the `router()` split (fix's `src/web/server/routing.rs` is 304 lines with the monolithic `router()` at line 25 — it fixed `panel_routes` its own way but kept the 121-line function that trips the monolith gate).
5. **Dry-ran the merge**: `git merge-tree --write-tree main fix/...` → clean; #196 is mergeable into main as-is.
6. **Delivered the collapse plan** and, on the follow-up `save-to-md`, filed bead `axon_rust-8x8w` carrying the full plan with commit SHAs and conflict notes.

## Key Findings

- **Duplicate feature implementations across branches**: the concurrent session's `e613e4d1` on the fix branch contains the fs-namespace affinity feature that PR #197 was created for — `src/jobs/migrations/0008_add_embed_fs_namespace.sql` is byte-identical on both branches (so no sqlx migration-checksum hazard against the already-migrated `~/.axon/jobs.db`).
- **#197 carries a deliberately-reverted commit**: `79b2594c` (audit relocation) was reverted on the fix branch by `3a2e52ea` as "not ready" and then redone properly (`8008eb66`); merging #197 as-is would reintroduce it.
- **Unique value left on #197 is exactly four commits**: `d2398b18` (qdrant `oom_score_adj -500`), `2e25fb68` (qdrant `cpus 4→8`), `8236783f` (`router()` split + concrete `panel_routes`), `b1436727` (session log).
- **fix's `routing.rs` still violates the monolith gate** (`router()` at `src/web/server/routing.rs:25`, 121 lines > 120) — explaining the `.monolith-allowlist` left dirty in that checkout; cherry-picking `8236783f` fixes it.
- **PR #196 merges clean into main** (merge-tree verified; main has not moved from `730d2c1e`).
- **zsh footgun**: `"$F:src/..."` inside double quotes still triggers zsh's `:s` history modifier on the variable — `"${F}:path"` is required for `git show <ref>:<path>` in this shell.

## Technical Decisions

- **Collapse rather than rebase the stack**: rebasing #197 onto the updated fix tip would mean dropping most of its commits as duplicates and resolving conflicts across 258 differing files for four commits of real content; cherry-picking those four onto fix and closing #197 is strictly less work and yields one reviewable PR.
- **Take the split `routing.rs` during the cherry-pick conflict**: it supersedes fix's variant (same `panel_routes` fix, plus the monolith-compliant `router()`).
- **Drop `79b2594c` entirely** — respecting the concurrent session's explicit revert decision.
- **Plan tracked as a bead** (`axon_rust-8x8w`) rather than prose-only, since execution is deferred until the concurrent session is idle (the fix branch lives in its checkout).

## Files Changed

| status | path | previous path | purpose | evidence |
|---|---|---|---|---|
| created | docs/sessions/2026-06-10-pr-196-197-mergeability-analysis.md | — | this session artifact | this commit |

No code changes this continuation — analysis only.

## Beads Activity

| bead | title | actions | final status | why it mattered |
|---|---|---|---|---|
| axon_rust-8x8w | Collapse PR #197 into PR #196: cherry-pick 4 unique commits, close #197 as superseded | created (P1, full plan + SHAs + conflict notes in description) | open | the executable merge plan survives session end and the concurrent-session handoff |

(The four beads from the earlier part of this session — dmz8, o9y2, p2oc, qg8o — were all closed previously; see the part-1 artifact.)

## Repository Maintenance

- **Plans**: no plans created or completed this continuation; no moves. The injected "Active plan" still points at the deprecated `~/workspace/axon_rust` copy and is unrelated. No-op.
- **Beads**: created `axon_rust-8x8w` (above). No other tracker changes; `bd dolt push` deferred to the part-1 close-out already performed and will ride the next session's sync (no new closures to sync — creation is local until pushed; see Open Questions).
- **Worktrees/branches** (evidence: injected `git worktree list` + branch listing): three worktrees, all active — main checkout on `fix/...` (concurrent session; **now pushed**, local == origin at `887d7c4f`), `.worktrees/affinity` (this session), `.worktrees/feat/axon_rust-8mu8` (concurrent session, 5.8.0). **Nothing deleted**; the affinity worktree and feat branch are scheduled for deletion in bead 8x8w *after* the cherry-picks land, not before.
- **Stale docs**: none touched or contradicted this continuation; no-op.

## Tools and Skills Used

- **Shell/git only** this continuation: `git fetch/branch/log/show/grep/diff/merge-tree`, `bd create/list`. One degraded behavior: zsh's `:s` modifier mangled `git show ref:path` until the variable was braced. PreToolUse hooks repeatedly suggested lumen semantic search; plain git was the correct tool for branch archaeology.
- **Skills**: `vibin:save-to-md` (this artifact).
- No subagents, MCP tools, or browser tools.

## Commands Executed

| command | result |
|---|---|
| `git fetch --all --prune; git branch -vva` | fix branch ahead 18 → later pushed (origin `887d7c4f`); feat synced `b1436727` |
| `git log origin/fix..fix --oneline` | the 18 concurrent-session commits, incl. `e613e4d1` (affinity) and `3a2e52ea` (audit revert) |
| `git diff fix feat -- src/jobs/migrations/` | empty — migration 0008 byte-identical |
| `git grep fs_namespace fix -- src/jobs/` | present in migration + enqueue + lifecycle on fix |
| `git show "${F}:docker-compose.prod.yaml" \| rg ...` | fix has `AXON_FS_NAMESPACE`, lacks `oom_score_adj` and `cpus: '8.0'` |
| `git show "${F}:src/web/server/routing.rs"` | 304 lines; monolithic `router()` at :25; `panel_routes` concrete |
| `git merge-tree --write-tree main fix/...` | clean merge into main |
| `bd create ...` | `axon_rust-8x8w` (P1, open) |

## Behavior Changes (Before/After)

| area | before | after |
|---|---|---|
| Merge strategy for the two open PRs | undefined; stacked PRs with heavy hidden overlap | documented + bead-tracked collapse plan: 4 cherry-picks onto fix, close #197, merge #196 alone |

No code or infrastructure changes this continuation.

## Verification Evidence

| command | expected | actual | status |
|---|---|---|---|
| `git diff fix feat -- src/jobs/migrations/` | identical migration 0008 | empty diff | pass |
| `git merge-tree --write-tree main fix/...` | conflict report | clean | pass |
| `git grep tei_concurrency_warning fix -- src/` | present if absorbed | `sqlite_tests.rs` match | pass |

## Risks and Rollback

- The collapse plan is analysis-only so far — **nothing is at risk until the cherry-picks run**. When they do: conflicts expected only in `docker-compose.prod.yaml` (trivial) and `src/web/server/routing.rs` (take the split); abort path is `git cherry-pick --abort`.
- The fix branch keeps moving under the concurrent session (it pushed `887d7c4f` mid-analysis); the four cherry-pick SHAs remain valid regardless, but re-verify the "missing on fix" list immediately before executing if more commits land.

## Decisions Not Taken

- **Rebasing #197 onto the fix tip**: 258 differing files to reconcile for four commits of unique content; rejected for the cherry-pick collapse.
- **Merging #197 as-is after #196**: would reintroduce the reverted `79b2594c` audit relocation and a duplicate affinity implementation.
- **Executing the collapse immediately**: the fix branch is checked out in the concurrent session's working tree; deferred until that session is idle (user to confirm timing).

## References

- PR #196: https://github.com/jmagar/axon/pull/196
- PR #197: https://github.com/jmagar/axon/pull/197
- Part 1 of this session: `docs/sessions/2026-06-09-code-review-remediation-embed-pipeline-qdrant-ops.md`
- Bead `axon_rust-8x8w` (collapse plan with SHAs and conflict notes)

## Open Questions

- Whether the concurrent session lands further commits on the fix branch before the cherry-picks run — re-check `git log --oneline fix ^feat` for new absorption right before executing.
- `bd dolt push` for the new bead has not yet run this continuation; the bead exists locally in the Dolt working set until the next sync.

## Next Steps

1. **When the concurrent session is idle**, execute bead `axon_rust-8x8w` in the main checkout: `git cherry-pick d2398b18 2e25fb68 8236783f b1436727`, resolve the compose (trivial) and routing.rs (take the split) conflicts, patch-bump per the branch's `xtask version_sync` gate, push.
2. Close **PR #197** as superseded; delete `feat/qdrant-affinity-tei-burst` and the `.worktrees/affinity` worktree.
3. Merge **PR #196** into main (verified clean).
4. Recreate the prod stack so the compose hardening applies to fresh containers: `docker compose --env-file ~/.axon/.env -f docker-compose.prod.yaml up -d`, then run `axon doctor`.
5. Run `bd dolt push` to sync bead `axon_rust-8x8w`.
