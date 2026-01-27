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
import sys
import json
import asyncio

from notebooklm import NotebookLMClient
from notebooklm.exceptions import RPCError, SourceAddError, RateLimitError


async def resolve_notebook(client, target: str) -> tuple[str, str]:
    """
    Resolve notebook ID and title from target.

    Resolution order:
    1. Try get(target) as notebook ID
    2. If that fails, list notebooks and find by title (case-insensitive)
    3. If no match found, create a new notebook with target as title

    Args:
        client: NotebookLMClient instance
        target: Notebook ID or title

    Returns:
        Tuple of (notebook_id, notebook_title)
    """
    # Try by ID first
    try:
        notebook = await client.notebooks.get(target)
        return notebook.id, notebook.title
    except RPCError:
        pass

    # Search existing notebooks by title
    notebooks = await client.notebooks.list()
    target_lower = target.lower()
    for nb in notebooks:
        if nb.title.lower() == target_lower:
            return nb.id, nb.title

    # No match found, create new
    notebook = await client.notebooks.create(title=target)
    return notebook.id, notebook.title


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


if __name__ == "__main__":
    asyncio.run(main())
