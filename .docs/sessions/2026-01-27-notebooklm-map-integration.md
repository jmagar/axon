# Session: NotebookLM Map Integration

**Date:** 01/27/2026
**Branch:** main
**Commit:** 29ab023

## Session Overview

Implemented `--notebook <id-or-name>` flag for the `map` command in firecrawl-cli. This sends discovered URLs as sources to a NotebookLM notebook via a Python child process. The feature follows a best-effort philosophy: notebook failures never fail the map command.

This session continued from a prior context-exhausted session that completed the initial TDD implementation (Phases 1-6 of the plan). This session handled: Ralph loop cancellation, e2e testing, two critical bug fixes discovered during e2e, and the final commit.

## Timeline

1. **Finishing skill invoked** - Ran test suites (315 TS, 9 Python pass), build clean
2. **Ralph loop cancelled** - Was at iteration 8, state file removed
3. **E2E test attempt #1 (FAIL)** - `ModuleNotFoundError: No module named 'notebooklm'`
   - Root cause: `python3` resolved to Linuxbrew Python 3.14, but `notebooklm` installed via pipx in Python 3.13 venv
   - Fix: Added `findPython()` to `src/utils/notebooklm.ts` that reads shebang from `which notebooklm` to find pipx venv Python
4. **E2E test attempt #2 (PASS)** - 5/5 URLs added to new "Test Notebook"
5. **E2E test: existing notebook by ID (PASS)** - 3/3 URLs added to notebook `186760e5-d665-4d43-a85c-cd987099c6eb`
6. **E2E test: existing notebook by name (FAIL pre-fix)** - Would create duplicate notebooks because `resolve_notebook` only tried `get()` by ID, then created new on RPCError
   - Fix: Updated `resolve_notebook()` to list notebooks and match by title (case-insensitive) before creating
   - Added 2 new Python tests (find by title, case-insensitive match), updated create test to mock empty list
7. **E2E test: existing notebook by name (PASS)** - Found existing "Test Notebook" by name, same ID returned
8. **Committed** as `29ab023` on main, 13 files, 3099 insertions

## Key Findings

### Python Environment Mismatch

- `which python3` -> `/home/linuxbrew/.linuxbrew/bin/python3` (Python 3.14.2)
- `which notebooklm` -> `/home/jmagar/.local/bin/notebooklm` (pipx, Python 3.13.7)
- Shebang: `#!/home/jmagar/.local/share/pipx/venvs/notebooklm-py/bin/python`
- Fix in `src/utils/notebooklm.ts:36-49`: `findPython()` resolves from shebang, falls back to `python3`

### NotebookLM API

- `client.notebooks.list()` returns all notebooks with `.id` and `.title` attributes
- `client.notebooks.get(id)` throws `RPCError` when ID not found
- `client.sources.add_url(notebook_id, url, wait=False)` queues without blocking
- `client.sources.wait_for_sources(notebook_id, ids, timeout)` polls with exponential backoff

### Self-Hosted Firecrawl

- Runs on `127.0.0.1:53002`
- Was down during initial e2e attempt, came back up

## Technical Decisions

| Decision                               | Reasoning                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Resolve Python from notebooklm shebang | pipx installs in isolated venvs; `python3` in PATH won't have the package   |
| Case-insensitive title matching        | Reduces friction; users shouldn't need exact casing                         |
| List all notebooks for title search    | NotebookLM API has no search-by-title endpoint; list is small enough        |
| Title match before create              | Prevents duplicate notebooks when using `--notebook "Name"` repeatedly      |
| Best-effort philosophy                 | Notebook integration is optional; map command must never fail because of it |

## Files Modified

### New Files

| File                                             | Purpose                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `scripts/notebooklm_add_urls.py`                 | Python helper: resolve notebook, add URLs (two-phase), output JSON  |
| `scripts/conftest.py`                            | Mocks `notebooklm` package for pytest (no install needed for tests) |
| `scripts/test_notebooklm_add_urls.py`            | 11 pytest tests covering all functions                              |
| `src/utils/notebooklm.ts`                        | TypeScript wrapper: findPython(), spawn script, parse result        |
| `src/__tests__/utils/notebooklm.test.ts`         | 5 vitest tests for wrapper error handling                           |
| `docs/plans/2026-01-27-map-notebooklm-design.md` | Feature design document                                             |
| `docs/plans/2026-01-27-map-notebooklm-plan.md`   | 36-step TDD implementation plan                                     |

### Modified Files

| File                                 | Change                                                           |
| ------------------------------------ | ---------------------------------------------------------------- |
| `src/types/map.ts`                   | Added `notebook?: string` to MapOptions                          |
| `src/commands/map.ts`                | NotebookLM integration in handleMapCommand (truncation, logging) |
| `src/index.ts`                       | Added `--notebook <id-or-name>` commander option                 |
| `src/__tests__/commands/map.test.ts` | 5 integration tests for notebook in handleMapCommand             |
| `README.md`                          | Documentation for --notebook flag, requirements, examples        |
| `.gitignore`                         | Added `__pycache__/` and `.pytest_cache/`                        |

## Commands Executed

```bash
# E2E tests
node dist/index.js map https://docs.clawd.bot --limit 5 --notebook "Test Notebook"
# -> Added 5/5 URLs, Notebook ID: 186760e5-d665-4d43-a85c-cd987099c6eb

node dist/index.js map https://docs.clawd.bot --limit 3 --search "getting started" --notebook "186760e5-d665-4d43-a85c-cd987099c6eb"
# -> Added 3/3 URLs to existing notebook by ID

node dist/index.js map https://docs.clawd.bot --limit 3 --search "getting started" --notebook "Test Notebook"
# -> Added 3/3 URLs to existing notebook by name (same ID)

# Test suites
pnpm test          # 315/315 pass
pnpm run build     # clean
uv run --with pytest --with pytest-asyncio python3 -m pytest scripts/ -v  # 11/11 pass
```

## Next Steps

- None required. Feature is committed and operational on main.
- If pushing to remote, no PR needed (committed directly to main per user choice).
