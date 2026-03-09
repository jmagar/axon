# GitHub Ingest
Last Modified: 2026-03-09

Version: 1.0.0
Last Updated: 01:26:53 | 02/25/2026 EST

> CLI reference (flags, subcommands, examples): [`docs/commands/ingest.md`](../commands/ingest.md)

Ingests a GitHub repository — source code, documentation, issues, pull requests, and wiki pages — into Qdrant via a hybrid approach: raw reqwest for file content, octocrab for metadata/issues/PRs, and `git clone` for wiki pages.

## What Gets Indexed

| Content | Condition |
|---------|-----------|
| Documentation files | Always: `.md`, `.mdx`, `.rst`, `.txt` |
| Source code files | When `--include-source` flag is set: `.rs`, `.py`, `.go`, `.ts`, `.js`, `.tsx`, `.jsx`, `.toml`, `.c`, `.cpp`, `.h`, `.hpp`, `.java`, `.kt`, `.rb`, `.php`, `.sh`, `.yaml`, `.yml`, `.json`, `.swift`, `.cs` |
| Issues | Open and closed, title + body |
| Pull requests | Open and closed, title + body |
| Wiki pages | When the repo has a public wiki |

**Excluded** regardless of flag: `target/`, `node_modules/`, `dist/`, `__pycache__/`, `.lock` files, `-lock.json` files. See `is_indexable_source_path()` in `crates/ingest/github.rs` for the full list.

## Prerequisites

A running Qdrant + TEI stack. `GITHUB_TOKEN` is optional but strongly recommended for any repo with more than a handful of files.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Optional | Personal access token (classic) with `repo` scope, or fine-grained token with `contents:read`. Without this: **60 req/hr**. With this: **5,000 req/hr**. Large repos hit the unauthenticated limit quickly. Required for private repos. |
| `AXON_COLLECTION` | Optional | Qdrant collection name (default: `cortex`) |
| `TEI_URL` | Required | TEI embedding service URL |

```bash
# .env
GITHUB_TOKEN=ghp_your_token_here
```

## URL / Name Parsing

The argument accepts:
- `owner/repo` — canonical form
- `https://github.com/owner/repo` — full URL (prefix stripped)
- `https://github.com/owner/repo.git` — `.git` suffix stripped

## How It Works

1. Validates and normalizes `owner/repo` from the input
2. Fetches the full file tree via `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`
3. Filters files through `is_indexable_doc_path()` (always) and `is_indexable_source_path()` (if `--include-source`)
4. Fetches file contents in parallel via `GET /repos/{owner}/{repo}/contents/{path}`
5. Fetches issues (all states) and PRs (all states) via octocrab with automatic pagination; embeds repo metadata (description, language, topics, license) from the `GET /repos/{owner}/{repo}` response; clones the wiki via `git clone --depth=1` and walks `.md`/`.rst`/`.txt` files
6. All content embedded via `embed_text_with_metadata()` → TEI → Qdrant with the GitHub URL as source metadata

## Qdrant Metadata Fields

All GitHub chunks carry structured `gh_*` payload fields built in `crates/ingest/github/meta.rs`. The fields present depend on chunk type.

### Repository chunks (`gh_is_pr: false`, file and wiki chunks)

| Field | Type | Description |
|-------|------|-------------|
| `gh_owner` | `string` | Repository owner (extracted from `full_name`) |
| `gh_stars` | `integer` | Stargazer count at index time |
| `gh_forks` | `integer` | Fork count at index time |
| `gh_open_issues` | `integer` | Open issue count at index time |
| `gh_language` | `string \| null` | Primary language as reported by GitHub |
| `gh_topics` | `string[]` | Repository topics array |
| `gh_created_at` | `string \| null` | Repository creation timestamp (RFC 3339) |
| `gh_pushed_at` | `string \| null` | Last push timestamp (RFC 3339) |
| `gh_is_fork` | `boolean` | Whether the repository is a fork |
| `gh_is_archived` | `boolean` | Whether the repository is archived |

### Issue chunks

| Field | Type | Description |
|-------|------|-------------|
| `gh_issue_number` | `integer` | GitHub issue number |
| `gh_state` | `string` | `"open"`, `"closed"`, or `"unknown"` |
| `gh_author` | `string` | Login of the issue author |
| `gh_created_at` | `string` | Issue creation timestamp (RFC 3339) |
| `gh_updated_at` | `string` | Issue last-updated timestamp (RFC 3339) |
| `gh_comment_count` | `integer` | Number of comments on the issue |
| `gh_labels` | `string[]` | Label names applied to the issue |
| `gh_is_pr` | `boolean` | Always `false` for issues |

### Pull request chunks

| Field | Type | Description |
|-------|------|-------------|
| `gh_issue_number` | `integer` | GitHub PR number |
| `gh_state` | `string` | `"open"`, `"closed"`, or `"unknown"` |
| `gh_author` | `string` | Login of the PR author (`""` if not available) |
| `gh_created_at` | `string \| null` | PR creation timestamp (RFC 3339) |
| `gh_updated_at` | `string \| null` | PR last-updated timestamp (RFC 3339) |
| `gh_labels` | `string[]` | Label names applied to the PR |
| `gh_is_pr` | `boolean` | Always `true` for pull requests |
| `gh_merged_at` | `string \| null` | Merge timestamp (RFC 3339); `null` if not merged |
| `gh_is_draft` | `boolean` | Whether the PR was a draft at index time |

## Known Limitations

| Limitation | Detail |
|-----------|--------|
| **Rate limits without token** | 60 req/hr unauthenticated. Any repo with 60+ files will exhaust this in one run. Set `GITHUB_TOKEN`. |
| **Private repos** | Require a token with `repo` (classic) or `contents:read` (fine-grained) scope |
| **Very large repos** | Tree-first + per-file fetching is O(file count). Large repos (thousands of files) take minutes even with a token. |
| **Binary files** | Excluded by extension list. The list is hardcoded; PRs welcome for additions. |
| **Forked repos** | Ingests the fork only, not upstream. |

## Troubleshooting

**`403 Forbidden` / rate limit errors**

Set `GITHUB_TOKEN` in `.env`. Verify the token has `contents:read` access (fine-grained) or `repo` scope (classic).

**`repository not found`**

Repo is private or doesn't exist. Check the owner/repo spelling and token permissions.

**Slow ingestion on large repos**

Expected — tree walk + per-file API calls for thousands of files is inherently sequential-ish (parallelism is bounded by GitHub's rate limit). Consider indexing only docs (`--include-source` off) or using a token to maximize rate allowance.
