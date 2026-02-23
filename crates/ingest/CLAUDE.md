# crates/ingest — Source Ingestion Handlers

Ingests external sources (GitHub, Reddit, YouTube, AI sessions) into Qdrant.

## Module Layout

```
ingest/
├── github.rs    # GitHub repo ingestion via octocrab (code, issues, PRs, wiki)
├── reddit.rs    # Subreddit post/comment ingestion via Reddit OAuth2 API
├── youtube.rs   # YouTube transcript ingestion via yt-dlp subprocess
└── sessions/    # AI session export parsers
    ├── claude.rs
    ├── codex.rs
    └── gemini.rs
```

## Source-Specific Patterns

### GitHub (`github.rs`)
- Uses `octocrab` crate
- `GITHUB_TOKEN` is **optional** but strongly recommended — unauthenticated rate limit is 60 req/hr; authenticated is 5000 req/hr
- Ingests: repo code files, issues (open+closed), PRs, wiki pages
- Large repos: code files are fetched tree-first, then content per file — can be slow without token

### Reddit (`reddit.rs`)
- Reddit OAuth2 **client credentials** flow (app-only, no user login)
- **Both** `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are **required** — command fails immediately if either is missing
- Fetches subreddit posts + top-level comments; depth is fixed (not configurable per-run)
- Rate limit: 100 req/min authenticated; uses `reqwest` directly (not spider)

### YouTube (`youtube.rs`)
- Invokes `yt-dlp` as a **subprocess** (not a library) — `yt-dlp` must be installed and on `$PATH`
- Downloads auto-generated or manual VTT subtitle file, then calls `parse_vtt_to_text()` to strip timing tags
- `extract_video_id()` handles full URLs, short URLs (`youtu.be/`), and bare IDs
- No API key needed; yt-dlp handles auth for publicly accessible videos

### Sessions (`sessions/`)
- Parses exported conversation files from Claude (`.json`), Codex (`.md`), Gemini (`.json`)
- Each parser (`claude.rs`, `codex.rs`, `gemini.rs`) extracts message pairs → flat text chunks
- Called by `crates/cli/commands/sessions.rs` — synchronous (no AMQP), like `ask`/`query`

## Testing

```bash
cargo test ingest         # all ingest unit tests (31 pure logic tests)
cargo test parse_vtt      # VTT subtitle parsing
cargo test extract_video  # YouTube video ID extraction
cargo test parse_github   # GitHub repo name/URL parsing
cargo test classify       # ingest source classifier
cargo test session        # session export format parsers
cargo test -- --nocapture # show parsed output
```

All ingest unit tests run without live services (pure logic: parsing, classification, ID extraction). Tests for `ingest_github`, `ingest_reddit`, `ingest_youtube` that hit real APIs require credentials set in env.

## Embedding Pattern
All ingest handlers call `embed_text_with_metadata()` from `crates/vector/ops/tei.rs` (re-exported from `vector/ops/mod.rs`). This function:
1. Chunks the text
2. Attaches source metadata (URL/source_type, title, etc.)
3. Calls `tei_embed()` with auto-split on 413
4. Upserts to Qdrant

## ingest_jobs Schema
`axon_ingest_jobs` differs from other job tables:
- Uses `source_type TEXT` (`github`/`reddit`/`youtube`) + `target TEXT` (repo name, subreddit, video URL)
- Does **NOT** have `url` or `urls_json` columns
- `worker_lane.rs` reads `AXON_INGEST_LANES` (default 2) to run parallel lanes

## Known Gaps

| Gap | Status |
|-----|--------|
| `axon ingest errors <uuid>` | Silently unhandled — `maybe_handle_ingest_subcommand` doesn't match `"errors"`, falls through to "requires subcommand" error. Fix: add `"errors"` arm to the match in `ingest_jobs.rs`. |
| YouTube age-restricted / private videos | `yt-dlp` will fail with a non-zero exit code; error propagates as `Box<dyn Error>`. No retry or friendly message. |
| Reddit comment depth | Fixed at top-level only — no recursive comment thread fetching. |

## yt-dlp Requirement

`yt-dlp` **must be installed and on `$PATH`**. The `youtube` command will fail at runtime with a cryptic process error if it's missing:
```
No such file or directory (os error 2)
```
Install: `pip install yt-dlp` or `brew install yt-dlp`. Verify: `yt-dlp --version`.

## Adding a New Ingest Source
1. Add parser in `crates/ingest/<source>.rs`
2. Add `CommandKind::<Source>` + CLI arg to `config.rs`
3. Add command handler in `crates/cli/commands/<source>.rs`
4. Add `source_type` variant handling in `ingest_jobs.rs` worker dispatch
5. Add env vars to `.env.example`
6. Add s6 worker lane entry if the source is job-queue-backed
