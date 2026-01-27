# Map NotebookLM Integration Implementation Plan

**Created:** 07:26:29 PM | 01/27/2026 (EST)
**Revised:** 01/27/2026 (TDD review fixes)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `--notebook <id-or-name>` flag to the `map` command that sends discovered URLs as sources to NotebookLM.

**Architecture:** Two-component integration using child_process to shell out to Python. TypeScript wrapper in `src/utils/notebooklm.ts` spawns `scripts/notebooklm_add_urls.py` and communicates via stdin/stdout JSON. Python script uses `notebooklm` library's two-phase approach (sequential add_url, then batch wait_for_sources). Best-effort: notebook integration never fails the map command.

**Tech Stack:** TypeScript (Node.js child_process), Python 3.11+, notebooklm library, vitest for TS testing, pytest + pytest-asyncio for Python testing

---

## Phase 1: Python Script (TDD)

### Step 1: Create directory structure and test infrastructure

**Create:** `scripts/` directory, conftest, and empty script

```bash
mkdir -p /home/jmagar/workspace/cli-firecrawl/scripts
touch /home/jmagar/workspace/cli-firecrawl/scripts/notebooklm_add_urls.py
chmod +x /home/jmagar/workspace/cli-firecrawl/scripts/notebooklm_add_urls.py
```

**Create:** `scripts/conftest.py`

```python
"""
Test configuration for notebooklm_add_urls.py

Mocks the notebooklm package so tests run without it installed.
"""
import sys
import os
from unittest.mock import MagicMock

# Create real exception classes for isinstance checks in tests
class RPCError(Exception):
    pass

class SourceAddError(Exception):
    pass

class RateLimitError(Exception):
    pass

# Build mock notebooklm module
mock_notebooklm = MagicMock()
mock_exceptions = MagicMock()
mock_exceptions.RPCError = RPCError
mock_exceptions.SourceAddError = SourceAddError
mock_exceptions.RateLimitError = RateLimitError

sys.modules["notebooklm"] = mock_notebooklm
sys.modules["notebooklm.exceptions"] = mock_exceptions

# Add scripts dir to path so tests can import the script
sys.path.insert(0, os.path.dirname(__file__))
```

**Verify:**

```bash
ls -la /home/jmagar/workspace/cli-firecrawl/scripts/
```

**Expected:** Directory contains `conftest.py` and `notebooklm_add_urls.py`

---

### Step 2: Write test for JSON I/O contract - RED

**Create:** `scripts/test_notebooklm_add_urls.py`

```python
"""Tests for notebooklm_add_urls.py"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_main_reads_stdin_and_outputs_json(monkeypatch):
    """main() should read JSON from stdin and write JSON result to stdout."""
    import io
    import sys

    input_data = {"notebook": "Test Notebook", "urls": ["https://example.com"]}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(input_data)))

    captured = io.StringIO()
    monkeypatch.setattr("sys.stdout", captured)

    from notebooklm_add_urls import main

    await main()

    output = json.loads(captured.getvalue())
    assert "notebook_id" in output
    assert "notebook_title" in output
    assert "added" in output
    assert "failed" in output
    assert "errors" in output
    assert isinstance(output["errors"], list)
```

**Run test:**

```bash
cd /home/jmagar/workspace/cli-firecrawl
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py -v
```

**Expected:** FAIL - `notebooklm_add_urls` has no `main` function (empty file)

---

### Step 3: Implement script stub with JSON I/O - GREEN

**Create:** `scripts/notebooklm_add_urls.py`

```python
#!/usr/bin/env python3
"""
NotebookLM URL batch adder.

Reads JSON from stdin: {"notebook": "...", "urls": [...]}
Outputs JSON to stdout: {"notebook_id": "...", "notebook_title": "...", "added": N, "failed": N, "errors": [...]}
"""
import sys
import json
import asyncio


async def main() -> None:
    """Main entry point - reads stdin, processes URLs, outputs result."""
    try:
        input_data = json.load(sys.stdin)
        notebook_target = input_data["notebook"]
        urls = input_data["urls"]

        result = {
            "notebook_id": "stub-id",
            "notebook_title": notebook_target,
            "added": len(urls),
            "failed": 0,
            "errors": [],
        }

        json.dump(result, sys.stdout)
        sys.stdout.flush()

    except Exception as e:
        error_result = {
            "notebook_id": "",
            "notebook_title": "",
            "added": 0,
            "failed": 0,
            "errors": [f"Script error: {str(e)}"],
        }
        json.dump(error_result, sys.stdout)
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
```

**Run test:**

```bash
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py::test_main_reads_stdin_and_outputs_json -v
```

**Expected:** PASS

---

### Step 4: Write test for resolve_notebook - RED

**Modify:** `scripts/test_notebooklm_add_urls.py`

Add tests:

```python
@pytest.mark.asyncio
async def test_resolve_notebook_gets_existing_by_id():
    """resolve_notebook should return existing notebook when get() succeeds."""
    mock_client = AsyncMock()
    mock_notebook = MagicMock()
    mock_notebook.id = "existing-id-123"
    mock_notebook.title = "Existing Notebook"
    mock_client.notebooks.get.return_value = mock_notebook

    from notebooklm_add_urls import resolve_notebook

    nb_id, nb_title = await resolve_notebook(mock_client, "existing-id-123")

    assert nb_id == "existing-id-123"
    assert nb_title == "Existing Notebook"
    mock_client.notebooks.get.assert_called_once_with("existing-id-123")


@pytest.mark.asyncio
async def test_resolve_notebook_creates_new_on_rpc_error():
    """resolve_notebook should create new notebook when get() raises RPCError."""
    from conftest import RPCError

    mock_client = AsyncMock()
    mock_client.notebooks.get.side_effect = RPCError("not found")
    mock_new_notebook = MagicMock()
    mock_new_notebook.id = "new-id-456"
    mock_new_notebook.title = "New Notebook"
    mock_client.notebooks.create.return_value = mock_new_notebook

    from notebooklm_add_urls import resolve_notebook

    nb_id, nb_title = await resolve_notebook(mock_client, "New Notebook")

    assert nb_id == "new-id-456"
    assert nb_title == "New Notebook"
    mock_client.notebooks.create.assert_called_once_with(title="New Notebook")
```

**Run test:**

```bash
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py -k "resolve" -v
```

**Expected:** FAIL - `resolve_notebook` not defined

---

### Step 5: Implement resolve_notebook - GREEN

**Modify:** `scripts/notebooklm_add_urls.py`

Add after existing imports:

```python
from notebooklm import NotebookLMClient
from notebooklm.exceptions import RPCError
```

Add before `main()`:

```python
async def resolve_notebook(client, target: str) -> tuple[str, str]:
    """
    Resolve notebook ID and title from target.

    Tries to get existing notebook by ID first. If that fails (RPCError),
    treats target as a title and creates a new notebook.

    Args:
        client: NotebookLMClient instance
        target: Notebook ID or title

    Returns:
        Tuple of (notebook_id, notebook_title)
    """
    try:
        notebook = await client.notebooks.get(target)
        return notebook.id, notebook.title
    except RPCError:
        notebook = await client.notebooks.create(title=target)
        return notebook.id, notebook.title
```

**Run test:**

```bash
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py -k "resolve" -v
```

**Expected:** PASS

---

### Step 6: Write test for add_urls_phase1 - RED

**Modify:** `scripts/test_notebooklm_add_urls.py`

Add tests:

```python
@pytest.mark.asyncio
async def test_add_urls_phase1_happy_path():
    """add_urls_phase1 should return source IDs for all successfully added URLs."""
    mock_client = AsyncMock()

    mock_source_1 = MagicMock()
    mock_source_1.id = "src-1"
    mock_source_2 = MagicMock()
    mock_source_2.id = "src-2"

    mock_client.sources.add_url.side_effect = [mock_source_1, mock_source_2]

    from notebooklm_add_urls import add_urls_phase1

    added, failed = await add_urls_phase1(
        mock_client, "nb-id", ["https://a.com", "https://b.com"]
    )

    assert added == ["src-1", "src-2"]
    assert failed == []
    assert mock_client.sources.add_url.call_count == 2


@pytest.mark.asyncio
async def test_add_urls_phase1_partial_failure():
    """add_urls_phase1 should collect failures without stopping."""
    from conftest import SourceAddError

    mock_client = AsyncMock()
    mock_source = MagicMock()
    mock_source.id = "src-1"

    mock_client.sources.add_url.side_effect = [
        mock_source,
        SourceAddError("bad url"),
        mock_source,
    ]

    from notebooklm_add_urls import add_urls_phase1

    added, failed = await add_urls_phase1(
        mock_client, "nb-id", ["https://a.com", "https://bad.com", "https://c.com"]
    )

    assert len(added) == 2
    assert len(failed) == 1
    assert failed[0][0] == "https://bad.com"
```

**Run test:**

```bash
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py -k "add_urls" -v
```

**Expected:** FAIL - `add_urls_phase1` not defined

---

### Step 7: Implement add_urls_phase1 - GREEN

**Modify:** `scripts/notebooklm_add_urls.py`

Add to imports:

```python
from notebooklm.exceptions import SourceAddError, RateLimitError
```

Add before `main()`:

```python
async def add_urls_phase1(
    client,
    notebook_id: str,
    urls: list[str],
) -> tuple[list[str], list[tuple[str, str]]]:
    """
    Phase 1: Sequentially add URLs without waiting for processing.

    Args:
        client: NotebookLMClient instance
        notebook_id: Target notebook ID
        urls: List of URLs to add

    Returns:
        Tuple of (added_source_ids, failed_url_error_pairs)
    """
    added_source_ids: list[str] = []
    failed: list[tuple[str, str]] = []

    for url in urls:
        try:
            source = await client.sources.add_url(
                notebook_id, url, wait=False
            )
            added_source_ids.append(source.id)
        except (SourceAddError, RateLimitError) as e:
            failed.append((url, str(e)))
        except Exception as e:
            failed.append((url, f"Unexpected error: {str(e)}"))

    return added_source_ids, failed
```

**Run test:**

```bash
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py -k "add_urls" -v
```

**Expected:** PASS

---

### Step 8: Write test for wait_for_sources_phase2 - RED

**Modify:** `scripts/test_notebooklm_add_urls.py`

Add tests:

```python
@pytest.mark.asyncio
async def test_wait_for_sources_phase2_calls_library():
    """wait_for_sources_phase2 should call wait_for_sources with correct args."""
    mock_client = AsyncMock()

    from notebooklm_add_urls import wait_for_sources_phase2

    await wait_for_sources_phase2(mock_client, "nb-id", ["src-1", "src-2"])

    mock_client.sources.wait_for_sources.assert_called_once_with(
        "nb-id", ["src-1", "src-2"], timeout=120.0
    )


@pytest.mark.asyncio
async def test_wait_for_sources_phase2_skips_empty():
    """wait_for_sources_phase2 should skip when no source IDs provided."""
    mock_client = AsyncMock()

    from notebooklm_add_urls import wait_for_sources_phase2

    await wait_for_sources_phase2(mock_client, "nb-id", [])

    mock_client.sources.wait_for_sources.assert_not_called()


@pytest.mark.asyncio
async def test_wait_for_sources_phase2_handles_timeout():
    """wait_for_sources_phase2 should not raise on TimeoutError."""
    mock_client = AsyncMock()
    mock_client.sources.wait_for_sources.side_effect = TimeoutError("timed out")

    from notebooklm_add_urls import wait_for_sources_phase2

    # Should not raise
    await wait_for_sources_phase2(mock_client, "nb-id", ["src-1"])
```

**Run test:**

```bash
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py -k "wait_for" -v
```

**Expected:** FAIL - `wait_for_sources_phase2` not defined

---

### Step 9: Implement wait_for_sources_phase2 - GREEN

**Modify:** `scripts/notebooklm_add_urls.py`

Add before `main()`:

```python
async def wait_for_sources_phase2(
    client,
    notebook_id: str,
    source_ids: list[str],
    timeout: float = 120.0,
) -> None:
    """
    Phase 2: Wait for all sources to complete processing.

    Uses library's wait_for_sources() which polls all sources in parallel
    with exponential backoff (1s initial, 1.5x factor, 10s max).

    Args:
        client: NotebookLMClient instance
        notebook_id: Target notebook ID
        source_ids: List of source IDs to wait for
        timeout: Maximum seconds to wait (default: 120)
    """
    if not source_ids:
        return

    try:
        await client.sources.wait_for_sources(
            notebook_id, source_ids, timeout=timeout
        )
    except TimeoutError:
        # Sources didn't finish processing in time, but they're added
        # This is not a failure - sources will eventually process
        pass
```

**Run test:**

```bash
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py -k "wait_for" -v
```

**Expected:** PASS

---

### Step 10: Write test for wired-up main() - RED

**Modify:** `scripts/test_notebooklm_add_urls.py`

Add test:

```python
@pytest.mark.asyncio
async def test_main_wires_all_phases(monkeypatch):
    """main() should resolve notebook, add URLs, wait for sources, and output JSON."""
    import io
    import sys
    from unittest.mock import patch, AsyncMock, MagicMock

    input_data = {"notebook": "My Notebook", "urls": ["https://a.com", "https://b.com"]}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(input_data)))

    captured = io.StringIO()
    monkeypatch.setattr("sys.stdout", captured)

    # Mock the client
    mock_client = AsyncMock()
    mock_notebook = MagicMock()
    mock_notebook.id = "nb-real-id"
    mock_notebook.title = "My Notebook"
    mock_client.notebooks.get.return_value = mock_notebook

    mock_src_1 = MagicMock()
    mock_src_1.id = "s1"
    mock_src_2 = MagicMock()
    mock_src_2.id = "s2"
    mock_client.sources.add_url.side_effect = [mock_src_1, mock_src_2]

    # Mock NotebookLMClient.from_storage to return our mock client
    mock_from_storage = AsyncMock(return_value=mock_client)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    import notebooklm_add_urls

    with patch.object(notebooklm_add_urls, "NotebookLMClient") as mock_cls:
        mock_cls.from_storage = mock_from_storage
        await notebooklm_add_urls.main()

    output = json.loads(captured.getvalue())
    assert output["notebook_id"] == "nb-real-id"
    assert output["notebook_title"] == "My Notebook"
    assert output["added"] == 2
    assert output["failed"] == 0
    assert output["errors"] == []
```

**Run test:**

```bash
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py::test_main_wires_all_phases -v
```

**Expected:** FAIL - `main()` still uses stub output, doesn't call resolve_notebook/add_urls/wait

---

### Step 11: Wire main() to use all functions - GREEN

**Modify:** `scripts/notebooklm_add_urls.py`

Replace `main()` with:

```python
async def main() -> None:
    """Main entry point - reads stdin, processes URLs, outputs result."""
    try:
        input_data = json.load(sys.stdin)
        notebook_target = input_data["notebook"]
        urls = input_data["urls"]

        async with await NotebookLMClient.from_storage() as client:
            # Resolve notebook (get existing or create)
            notebook_id, notebook_title = await resolve_notebook(
                client, notebook_target
            )

            # Phase 1: Add URLs sequentially without waiting
            added_source_ids, failed = await add_urls_phase1(
                client, notebook_id, urls
            )

            # Phase 2: Wait for all sources to finish processing
            await wait_for_sources_phase2(client, notebook_id, added_source_ids)

            # Format errors
            error_messages = [f"{url}: {error}" for url, error in failed]

            result = {
                "notebook_id": notebook_id,
                "notebook_title": notebook_title,
                "added": len(added_source_ids),
                "failed": len(failed),
                "errors": error_messages,
            }

            json.dump(result, sys.stdout)
            sys.stdout.flush()

    except Exception as e:
        error_result = {
            "notebook_id": "",
            "notebook_title": "",
            "added": 0,
            "failed": 0,
            "errors": [f"Script error: {str(e)}"],
        }
        json.dump(error_result, sys.stdout)
        sys.stdout.flush()
        sys.exit(1)
```

**Run test:**

```bash
uv run --with pytest --with pytest-asyncio pytest scripts/test_notebooklm_add_urls.py -v
```

**Expected:** ALL PASS

---

### Step 12: Verify script runs standalone

```bash
cd /home/jmagar/workspace/cli-firecrawl
echo '{"notebook": "Test", "urls": ["https://example.com"]}' | python3 scripts/notebooklm_add_urls.py 2>&1 || true
```

**Expected:** Either JSON output (if notebooklm installed) or error JSON (if not). Script doesn't crash.

---

## Phase 2: TypeScript Wrapper (TDD)

### Step 13: Write happy path test - RED

**Create:** `src/__tests__/utils/notebooklm.test.ts`

```typescript
/**
 * Tests for NotebookLM integration wrapper
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addUrlsToNotebook } from '../../utils/notebooklm';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('addUrlsToNotebook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return result on successful execution', async () => {
    const mockStdout = JSON.stringify({
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 2,
      failed: 0,
      errors: [],
    });

    const mockProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
      },
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from(mockStdout));
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(0);
        }
      }),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(mockProcess);

    const result = await addUrlsToNotebook('Test Notebook', [
      'https://example.com',
      'https://test.com',
    ]);

    expect(result).toEqual({
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 2,
      failed: 0,
      errors: [],
    });

    expect(spawn).toHaveBeenCalledWith(
      'python3',
      ['scripts/notebooklm_add_urls.py'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );

    expect(mockProcess.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({
        notebook: 'Test Notebook',
        urls: ['https://example.com', 'https://test.com'],
      })
    );
    expect(mockProcess.stdin.end).toHaveBeenCalled();
  });
});
```

**Run test:**

```bash
cd /home/jmagar/workspace/cli-firecrawl
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** FAIL - `Cannot find module '../../utils/notebooklm'`

---

### Step 14: Create TypeScript wrapper stub - still RED

**Create:** `src/utils/notebooklm.ts`

```typescript
/**
 * NotebookLM integration wrapper
 */

export interface NotebookResult {
  notebook_id: string;
  notebook_title: string;
  added: number;
  failed: number;
  errors: string[];
}

/**
 * Add URLs to a NotebookLM notebook (best-effort, never throws)
 */
export async function addUrlsToNotebook(
  notebookTarget: string,
  urls: string[]
): Promise<NotebookResult | null> {
  return null;
}
```

**Run test:**

```bash
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** FAIL - returns null instead of expected result

---

### Step 15: Implement happy path ONLY (no error handling) - GREEN

**Modify:** `src/utils/notebooklm.ts`

```typescript
/**
 * NotebookLM integration wrapper
 */

import { spawn } from 'child_process';

export interface NotebookResult {
  notebook_id: string;
  notebook_title: string;
  added: number;
  failed: number;
  errors: string[];
}

/**
 * Add URLs to a NotebookLM notebook (best-effort, never throws)
 */
export async function addUrlsToNotebook(
  notebookTarget: string,
  urls: string[]
): Promise<NotebookResult | null> {
  return new Promise((resolve) => {
    const child = spawn('python3', ['scripts/notebooklm_add_urls.py'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const payload = JSON.stringify({
      notebook: notebookTarget,
      urls,
    });

    child.stdin.write(payload);
    child.stdin.end();

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', () => {
      // Collect stderr but don't use it yet
    });

    child.on('close', () => {
      const result = JSON.parse(stdout) as NotebookResult;
      resolve(result);
    });
  });
}
```

**Run test:**

```bash
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** PASS - happy path works

---

### Step 16: Write spawn error test - RED

**Modify:** `src/__tests__/utils/notebooklm.test.ts`

Add test inside the describe block:

```typescript
it('should return null when python3 is not found', async () => {
  const mockProcess = {
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event, callback) => {
      if (event === 'error') {
        callback(new Error('spawn python3 ENOENT'));
      }
    }),
  } as unknown as ChildProcess;

  vi.mocked(spawn).mockReturnValue(mockProcess);

  const result = await addUrlsToNotebook('Test', ['https://example.com']);

  expect(result).toBeNull();
}, 3000);
```

**Run test:**

```bash
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** FAIL - promise never resolves (no error handler), times out

---

### Step 17: Add spawn error handler - GREEN

**Modify:** `src/utils/notebooklm.ts`

Add after `child.on('close', ...)`:

```typescript
// Handle spawn errors (e.g., python3 not found)
child.on('error', (error) => {
  console.error(`[NotebookLM] Failed to spawn Python script: ${error.message}`);
  resolve(null);
});
```

**Run test:**

```bash
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** PASS - both tests pass

---

### Step 18: Write non-zero exit code test - RED

**Modify:** `src/__tests__/utils/notebooklm.test.ts`

Add test:

```typescript
it('should return null when script exits with non-zero code', async () => {
  const mockProcess = {
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('notebooklm not installed'));
        }
      }),
    },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        callback(1);
      }
    }),
  } as unknown as ChildProcess;

  vi.mocked(spawn).mockReturnValue(mockProcess);

  const result = await addUrlsToNotebook('Test', ['https://example.com']);

  expect(result).toBeNull();
});
```

**Run test:**

```bash
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** FAIL - `JSON.parse('')` throws (no exit code check, stdout is empty)

---

### Step 19: Add exit code check - GREEN

**Modify:** `src/utils/notebooklm.ts`

Replace the `child.on('close', ...)` handler:

```typescript
// Collect stderr for debugging
let stderr = '';
child.stderr.on('data', (data) => {
  stderr += data.toString();
});

// Handle process exit
child.on('close', (code) => {
  if (code !== 0) {
    console.error(`[NotebookLM] Script failed with code ${code}`);
    if (stderr) {
      console.error(`[NotebookLM] ${stderr}`);
    }
    resolve(null);
    return;
  }

  const result = JSON.parse(stdout) as NotebookResult;
  resolve(result);
});
```

**Run test:**

```bash
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** PASS - all three tests pass

---

### Step 20: Write invalid JSON output test - RED

**Modify:** `src/__tests__/utils/notebooklm.test.ts`

Add test:

```typescript
it('should return null when script outputs invalid JSON', async () => {
  const mockProcess = {
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    stdout: {
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('not valid json'));
        }
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        callback(0);
      }
    }),
  } as unknown as ChildProcess;

  vi.mocked(spawn).mockReturnValue(mockProcess);

  const result = await addUrlsToNotebook('Test', ['https://example.com']);

  expect(result).toBeNull();
});
```

**Run test:**

```bash
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** FAIL - `JSON.parse('not valid json')` throws unhandled inside promise

---

### Step 21: Add JSON parse try/catch - GREEN

**Modify:** `src/utils/notebooklm.ts`

Replace the JSON.parse in the close handler:

```typescript
try {
  const result = JSON.parse(stdout) as NotebookResult;
  resolve(result);
} catch {
  console.error('[NotebookLM] Failed to parse script output');
  resolve(null);
}
```

**Run test:**

```bash
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** PASS - all four tests pass

---

### Step 22: Write partial success test - GREEN (validates contract)

**Modify:** `src/__tests__/utils/notebooklm.test.ts`

Add test:

```typescript
it('should return partial result when some URLs fail', async () => {
  const mockStdout = JSON.stringify({
    notebook_id: 'abc123',
    notebook_title: 'Test Notebook',
    added: 2,
    failed: 1,
    errors: ['https://bad.com: Rate limit exceeded'],
  });

  const mockProcess = {
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    stdout: {
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(mockStdout));
        }
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        callback(0);
      }
    }),
  } as unknown as ChildProcess;

  vi.mocked(spawn).mockReturnValue(mockProcess);

  const result = await addUrlsToNotebook('Test', [
    'https://example.com',
    'https://test.com',
    'https://bad.com',
  ]);

  expect(result).toEqual({
    notebook_id: 'abc123',
    notebook_title: 'Test Notebook',
    added: 2,
    failed: 1,
    errors: ['https://bad.com: Rate limit exceeded'],
  });
});
```

**Run test:**

```bash
pnpm test src/__tests__/utils/notebooklm.test.ts
```

**Expected:** PASS - happy path implementation handles this contract correctly

---

## Phase 3: Map Command Integration (TDD)

### Step 23: Add notebook field to MapOptions type

**Modify:** `src/types/map.ts` - add after `timeout?: number;` (line 31):

```typescript
  /** Timeout in seconds */
  timeout?: number;
  /** NotebookLM notebook ID or name to add URLs to */
  notebook?: string;
}
```

**Verify:**

```bash
cd /home/jmagar/workspace/cli-firecrawl
pnpm run build
```

**Expected:** Build succeeds (no type errors)

---

### Step 24: Write ALL map integration tests (including edge cases) - RED

**Modify:** `src/__tests__/commands/map.test.ts`

Add imports at top of file (after existing imports):

```typescript
import { handleMapCommand } from '../../commands/map';
import * as notebooklm from '../../utils/notebooklm';
```

Add mock after existing `vi.mock` calls:

```typescript
// Mock NotebookLM integration
vi.mock('../../utils/notebooklm', () => ({
  addUrlsToNotebook: vi.fn(),
}));

// Mock output utility to prevent side effects
vi.mock('../../utils/output', () => ({
  writeOutput: vi.fn(),
}));
```

Add new describe block at end of file:

```typescript
describe('handleMapCommand with notebook integration', () => {
  let mockClient: any;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupTest();
    initializeConfig({
      apiKey: 'test-api-key',
      apiUrl: 'https://api.firecrawl.dev',
    });

    mockClient = {
      map: vi.fn(),
    };

    vi.mocked(getClient).mockReturnValue(mockClient as any);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation();
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    teardownTest();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('should call addUrlsToNotebook when notebook option is provided', async () => {
    const mockResponse = {
      links: [
        { url: 'https://example.com/page1' },
        { url: 'https://example.com/page2' },
      ],
    };
    mockClient.map.mockResolvedValue(mockResponse);

    const mockNotebookResult = {
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 2,
      failed: 0,
      errors: [],
    };
    vi.mocked(notebooklm.addUrlsToNotebook).mockResolvedValue(
      mockNotebookResult
    );

    await handleMapCommand({
      urlOrJobId: 'https://example.com',
      notebook: 'Test Notebook',
    });

    expect(notebooklm.addUrlsToNotebook).toHaveBeenCalledWith('Test Notebook', [
      'https://example.com/page1',
      'https://example.com/page2',
    ]);
  });

  it('should not call addUrlsToNotebook when notebook option is not provided', async () => {
    const mockResponse = {
      links: [{ url: 'https://example.com/page1' }],
    };
    mockClient.map.mockResolvedValue(mockResponse);

    await handleMapCommand({
      urlOrJobId: 'https://example.com',
    });

    expect(notebooklm.addUrlsToNotebook).not.toHaveBeenCalled();
  });

  it('should continue map command even if notebook integration fails', async () => {
    const mockResponse = {
      links: [{ url: 'https://example.com/page1' }],
    };
    mockClient.map.mockResolvedValue(mockResponse);

    vi.mocked(notebooklm.addUrlsToNotebook).mockResolvedValue(null);

    // Should not throw
    await handleMapCommand({
      urlOrJobId: 'https://example.com',
      notebook: 'Test Notebook',
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('NotebookLM')
    );
  });

  it('should skip notebook integration when map returns no URLs', async () => {
    const mockResponse = {
      links: [],
    };
    mockClient.map.mockResolvedValue(mockResponse);

    await handleMapCommand({
      urlOrJobId: 'https://empty.com',
      notebook: 'Test Notebook',
    });

    expect(notebooklm.addUrlsToNotebook).not.toHaveBeenCalled();
  });

  it('should truncate to 300 URLs and warn when limit exceeded', async () => {
    const links = Array.from({ length: 350 }, (_, i) => ({
      url: `https://example.com/page${i}`,
    }));

    const mockResponse = { links };
    mockClient.map.mockResolvedValue(mockResponse);

    const mockNotebookResult = {
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 300,
      failed: 0,
      errors: [],
    };
    vi.mocked(notebooklm.addUrlsToNotebook).mockResolvedValue(
      mockNotebookResult
    );

    await handleMapCommand({
      urlOrJobId: 'https://example.com',
      notebook: 'Test Notebook',
    });

    // Should only pass first 300 URLs
    const calledUrls = vi.mocked(notebooklm.addUrlsToNotebook).mock.calls[0][1];
    expect(calledUrls.length).toBe(300);
    expect(calledUrls[0]).toBe('https://example.com/page0');
    expect(calledUrls[299]).toBe('https://example.com/page299');

    // Should log warning
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Truncating to 300')
    );
  });
});
```

**Run test:**

```bash
pnpm test src/__tests__/commands/map.test.ts
```

**Expected:** FAIL - `addUrlsToNotebook` is never called from `handleMapCommand`

---

### Step 25: Implement notebook integration in handleMapCommand - GREEN

**Modify:** `src/commands/map.ts`

Add import at line 5:

```typescript
import { addUrlsToNotebook } from '../utils/notebooklm';
```

Replace `handleMapCommand` (lines 73-98):

```typescript
/**
 * Handle map command output and optional NotebookLM integration
 */
export async function handleMapCommand(options: MapOptions): Promise<void> {
  const result = await executeMap(options);

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (!result.data) {
    return;
  }

  // Optional: Add URLs to NotebookLM notebook
  if (options.notebook && result.data.links.length > 0) {
    const urls = result.data.links.map((link) => link.url);

    // Truncate to 300 URLs (NotebookLM Pro limit)
    if (urls.length > 300) {
      console.error(
        `[NotebookLM] Warning: Truncating to 300 URLs (NotebookLM limit), found ${urls.length}`
      );
    }

    const urlsToAdd = urls.slice(0, 300);

    console.error(
      `[NotebookLM] Adding ${urlsToAdd.length} URLs to notebook "${options.notebook}"...`
    );

    const notebookResult = await addUrlsToNotebook(options.notebook, urlsToAdd);

    if (notebookResult) {
      if (notebookResult.failed === 0) {
        console.error(
          `[NotebookLM] Added ${notebookResult.added}/${urlsToAdd.length} URLs as sources`
        );
      } else {
        console.error(
          `[NotebookLM] Added ${notebookResult.added}/${urlsToAdd.length} URLs as sources (${notebookResult.failed} failed)`
        );
        notebookResult.errors.slice(0, 5).forEach((error) => {
          console.error(`[NotebookLM]   - ${error}`);
        });
        if (notebookResult.errors.length > 5) {
          console.error(
            `[NotebookLM]   ... and ${notebookResult.errors.length - 5} more errors`
          );
        }
      }
      console.error(`[NotebookLM] Notebook ID: ${notebookResult.notebook_id}`);
    } else {
      console.error(
        '[NotebookLM] Failed to add URLs. Check that python3 and notebooklm are installed.'
      );
    }
  }

  let outputContent: string;

  if (options.json) {
    outputContent = options.pretty
      ? JSON.stringify({ success: true, data: result.data }, null, 2)
      : JSON.stringify({ success: true, data: result.data });
  } else {
    outputContent = formatMapReadable(result.data);
  }

  writeOutput(outputContent, options.output, !!options.output);
}
```

**Run test:**

```bash
pnpm test src/__tests__/commands/map.test.ts
```

**Expected:** PASS - all tests pass (existing + new)

---

### Step 26: Verify no regression across full test suite

```bash
pnpm test
```

**Expected:** All tests pass

---

## Phase 4: CLI Option Integration

### Step 27: Add --notebook option to map command definition

**Modify:** `src/index.ts`

After line 272 (`.option('--timeout <seconds>', 'Timeout in seconds', parseFloat)`), add:

```typescript
    .option(
      '--notebook <id-or-name>',
      'Add discovered URLs to NotebookLM notebook (ID or name)'
    )
```

At line 302 (in mapOptions object), add `notebook` before the closing brace:

```typescript
        ignoreQueryParameters: options.ignoreQueryParameters,
        timeout: options.timeout,
        notebook: options.notebook,
      };
```

**Verify:**

```bash
cd /home/jmagar/workspace/cli-firecrawl
pnpm run build
```

**Expected:** Build succeeds

---

### Step 28: Verify CLI help output

```bash
node dist/index.js map --help
```

**Expected:** Output includes:

```
--notebook <id-or-name>  Add discovered URLs to NotebookLM notebook (ID or name)
```

---

## Phase 5: Manual Integration Testing

### Step 29: Test without NotebookLM authentication

```bash
cd /home/jmagar/workspace/cli-firecrawl
node dist/index.js map https://example.com --limit 5 --notebook "Test Notebook"
```

**Expected:**

- Map executes successfully and outputs URLs to stdout
- stderr shows: `[NotebookLM] Adding 5 URLs...`
- stderr shows: `[NotebookLM] Failed to add URLs...` (graceful failure)
- Exit code 0

---

### Step 30: Test with NotebookLM authentication (if available)

```bash
cd /home/jmagar/workspace/cli-firecrawl
notebooklm login
node dist/index.js map https://example.com --limit 3 --notebook "CLI Test Notebook"
```

**Expected:**

- Map output on stdout (3 URLs)
- stderr shows: `[NotebookLM] Added 3/3 URLs as sources`
- stderr shows: `[NotebookLM] Notebook ID: <actual-id>`
- Exit code 0

---

## Phase 6: Documentation and Cleanup

### Step 31: Add inline documentation to notebooklm.ts

**Modify:** `src/utils/notebooklm.ts`

Add module-level JSDoc at top:

```typescript
/**
 * NotebookLM integration wrapper
 *
 * Provides best-effort integration with NotebookLM via Python child process.
 * Never throws errors - all failures return null and log to stderr.
 *
 * Requirements:
 * - python3 installed and in PATH
 * - notebooklm package installed: `pip install notebooklm`
 * - User authenticated: `notebooklm login`
 *
 * Architecture:
 * - Spawns scripts/notebooklm_add_urls.py as child process
 * - Communicates via JSON over stdin/stdout
 * - Python script uses two-phase approach (add, then wait)
 *
 * @module utils/notebooklm
 */
```

Update function JSDoc:

```typescript
/**
 * Add URLs to a NotebookLM notebook (best-effort, never throws)
 *
 * Shells out to Python script that uses the notebooklm library.
 * If the notebook target is an ID, adds to existing notebook.
 * If the notebook target is a name, creates a new notebook.
 *
 * Uses two-phase approach per library docs:
 * 1. Sequential add_url(wait=False) - queue all URLs
 * 2. Batch wait_for_sources() - poll all in parallel
 *
 * @param notebookTarget - Notebook ID or name
 * @param urls - List of URLs to add as sources
 * @returns NotebookResult on success, null on any failure
 */
```

**Verify:**

```bash
pnpm run build
```

**Expected:** Build succeeds

---

### Step 32: Enhance Python script docstring

**Modify:** `scripts/notebooklm_add_urls.py` - replace module docstring:

```python
#!/usr/bin/env python3
"""
NotebookLM URL batch adder.

Helper script for firecrawl-cli that adds discovered URLs to a NotebookLM notebook.
Designed to be spawned via child_process from TypeScript wrapper.

Input (stdin JSON):
    {"notebook": "notebook-id-or-name", "urls": ["https://...", ...]}

Output (stdout JSON):
    {"notebook_id": "abc123...", "notebook_title": "...", "added": N, "failed": N, "errors": [...]}

Exit Codes:
    0 - Success (even if some URLs failed to add)
    1 - Fatal error (script crash, missing dependencies, auth failure)

Two-Phase Approach (per notebooklm library docs):
    Phase 1: Sequential add_url(wait=False) - Queue URLs without waiting
    Phase 2: Batch wait_for_sources() - Poll all sources in parallel

Requirements:
    - Python 3.11+
    - notebooklm package: pip install notebooklm
    - Authenticated: notebooklm login

Usage:
    echo '{"notebook": "Test", "urls": ["https://example.com"]}' | python3 notebooklm_add_urls.py
"""
```

---

### Step 33: Update README with notebook flag documentation

**Modify:** `README.md` (find map command section)

Add after existing map command examples:

````markdown
#### NotebookLM Integration

Add discovered URLs directly to a NotebookLM notebook:

```bash
# Create new notebook from mapped URLs
firecrawl map https://docs.example.com --notebook "Example Docs"

# Add to existing notebook by ID
firecrawl map https://docs.example.com --notebook "abc123def456"

# Combine with other options
firecrawl map https://docs.example.com --limit 50 --search "api" --notebook "API Docs"
```
````

**Requirements:**

- Python 3.11+ installed
- NotebookLM package: `pip install notebooklm`
- Authenticated: `notebooklm login`

**Notes:**

- Maximum 300 URLs (NotebookLM Pro limit)
- Best-effort: notebook failures don't fail the map command
- Progress messages go to stderr, map output to stdout

````

---

### Step 34: Run full test suite and build

```bash
cd /home/jmagar/workspace/cli-firecrawl
pnpm test && pnpm run build
````

**Expected:** All tests pass, build succeeds, `dist/utils/notebooklm.js` exists

---

## Phase 7: Commit

### Step 35: Stage specific files

```bash
cd /home/jmagar/workspace/cli-firecrawl
git add \
  scripts/notebooklm_add_urls.py \
  scripts/conftest.py \
  scripts/test_notebooklm_add_urls.py \
  src/utils/notebooklm.ts \
  src/__tests__/utils/notebooklm.test.ts \
  src/types/map.ts \
  src/commands/map.ts \
  src/index.ts \
  src/__tests__/commands/map.test.ts \
  README.md
git status
```

**Expected:** Shows all new/modified files staged:

- `scripts/notebooklm_add_urls.py` (new)
- `scripts/conftest.py` (new)
- `scripts/test_notebooklm_add_urls.py` (new)
- `src/utils/notebooklm.ts` (new)
- `src/__tests__/utils/notebooklm.test.ts` (new)
- `src/types/map.ts` (modified)
- `src/commands/map.ts` (modified)
- `src/index.ts` (modified)
- `src/__tests__/commands/map.test.ts` (modified)
- `README.md` (modified)

---

### Step 36: Commit changes

```bash
cd /home/jmagar/workspace/cli-firecrawl
git commit -m "$(cat <<'EOF'
feat: add NotebookLM integration to map command

Add --notebook flag to map command that sends discovered URLs
as sources to a NotebookLM notebook via Python child process.

Changes:
- Add scripts/notebooklm_add_urls.py: Python helper using notebooklm library
- Add scripts/conftest.py + test file: pytest tests for Python script
- Add src/utils/notebooklm.ts: TypeScript wrapper spawning Python script
- Add src/__tests__/utils/notebooklm.test.ts: Tests for wrapper
- Update src/types/map.ts: Add notebook?: string to MapOptions
- Update src/commands/map.ts: Integrate notebook after successful map
- Update src/index.ts: Add --notebook CLI option
- Update src/__tests__/commands/map.test.ts: Add notebook integration tests
- Update README.md: Document notebook flag usage

Features:
- Two-phase approach: sequential add_url, then batch wait_for_sources
- Best-effort: notebook failures never fail map command
- Auto-truncates to 300 URLs (NotebookLM Pro limit)
- Progress/errors go to stderr, map output to stdout unchanged
- Handles: python3 not found, notebooklm not installed, auth expired

Requires: python3, pip install notebooklm, notebooklm login

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

**Verify:**

```bash
git log -1 --stat
```

**Expected:** Commit created with all files, proper message

---

## Completion Checklist

- [ ] Python script created with two-phase approach (add + wait)
- [ ] Python script has pytest tests with mocked NotebookLMClient
- [ ] TypeScript wrapper handles all error cases gracefully
- [ ] TypeScript wrapper has per-error-case TDD (RED-GREEN for each)
- [ ] MapOptions type includes notebook field
- [ ] Map command integrates notebook after successful execution
- [ ] Map integration tests include edge cases (empty, truncation)
- [ ] Map tests mock writeOutput and process.exit properly
- [ ] CLI option added to commander definition
- [ ] URL truncation at 300 in TS handler only (no double truncation)
- [ ] All tests pass (Python + TypeScript, unit + integration)
- [ ] Progress messages on stderr, output on stdout
- [ ] Documentation added to README
- [ ] Build succeeds with no warnings
- [ ] Manual testing completed (with and without auth)
- [ ] Changes committed with specific file staging (no `git add -A`)

---

## Rollback Plan

If issues arise during implementation:

1. **Revert commit:**

   ```bash
   git revert HEAD
   ```

2. **Or reset to previous state:**

   ```bash
   git reset --hard HEAD~1
   ```

3. **Remove new files:**

   ```bash
   rm -rf scripts/
   rm src/utils/notebooklm.ts
   rm src/__tests__/utils/notebooklm.test.ts
   ```

4. **Rebuild:**
   ```bash
   pnpm run build
   ```

---

## Notes for Executor

- **TDD Discipline:** Every function follows RED-GREEN-REFACTOR. Write the test, see it FAIL, then implement ONLY enough code to make it pass.
- **Python TDD:** conftest.py mocks the `notebooklm` package so pytest works without it installed.
- **TypeScript TDD:** Error handling is built incrementally. Step 15 has NO error handling. Steps 16-21 each add ONE error handler driven by a failing test.
- **Mock Completeness:** Map integration tests mock `writeOutput`, `process.exit`, and `console.error` to prevent side effects.
- **Single Truncation:** URL truncation happens ONLY in the TypeScript handler (`src/commands/map.ts`). The Python script trusts its input.
- **consoleErrorSpy:** Created in `beforeEach` and restored in `afterEach` to avoid cross-test contamination.
- **Bite-Sized:** Each step is 2-5 minutes of focused work.
- **Verify Always:** Run the verification command after each step.
- **Best-Effort Philosophy:** Notebook integration NEVER fails the map command.
- **Specific Staging:** Use explicit file paths with `git add` (never `git add -A`).

---

## Changes From Original Plan (Review Fixes)

| Issue                     | Original                               | Fixed                                            |
| ------------------------- | -------------------------------------- | ------------------------------------------------ |
| No Python tests           | Manual `echo \| python3` only          | Full pytest suite with mocked client             |
| Steps 9-11 test-after     | Tests written after all error handling | Each error handler has own RED-GREEN cycle       |
| Steps 20-21 test-after    | Edge case tests after implementation   | Edge case tests in Step 24 (before Step 25)      |
| Missing writeOutput mock  | Not mocked                             | `vi.mock('../../utils/output')` added            |
| Missing process.exit mock | Not mocked                             | `vi.spyOn(process, 'exit')` added                |
| consoleErrorSpy scope     | Declared at describe level             | Created in `beforeEach`, restored in `afterEach` |
| Double truncation         | Both Python + TypeScript truncate      | TypeScript only (Python trusts input)            |
| `git add -A`              | Could stage unrelated files            | Explicit file list                               |
| Partial success test      | Pre-passed (test-after)                | Step 22 validates contract (acknowledged GREEN)  |

---

## Success Criteria

- Users can run: `firecrawl map <url> --notebook "My Docs"`
- URLs are added to NotebookLM notebook as individual sources
- Map command never fails due to notebook issues
- Works with both notebook IDs and names (create new)
- Handles 300+ URLs gracefully with truncation warning
- All tests pass (Python pytest + TypeScript vitest)
- Documentation complete and accurate
- No regressions in existing map functionality
