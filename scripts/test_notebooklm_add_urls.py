"""Tests for notebooklm_add_urls.py"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_main_reads_stdin_and_outputs_json(monkeypatch):
    """main() should read JSON from stdin and write JSON result to stdout."""
    import io
    import sys
    from unittest.mock import patch

    input_data = {"notebook": "Test Notebook", "urls": ["https://example.com"]}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(input_data)))

    captured = io.StringIO()
    monkeypatch.setattr("sys.stdout", captured)

    # Mock the client
    mock_client = AsyncMock()
    mock_notebook = MagicMock()
    mock_notebook.id = "test-id"
    mock_notebook.title = "Test Notebook"
    mock_client.notebooks.get.return_value = mock_notebook

    mock_source = MagicMock()
    mock_source.id = "src-1"
    mock_client.sources.add_url.return_value = mock_source

    mock_from_storage = AsyncMock(return_value=mock_client)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    import notebooklm_add_urls

    with patch.object(notebooklm_add_urls, "NotebookLMClient") as mock_cls:
        mock_cls.from_storage = mock_from_storage
        await notebooklm_add_urls.main()

    output = json.loads(captured.getvalue())
    assert "notebook_id" in output
    assert "notebook_title" in output
    assert "added" in output
    assert "failed" in output
    assert "errors" in output
    assert isinstance(output["errors"], list)


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
async def test_resolve_notebook_finds_existing_by_title():
    """resolve_notebook should find existing notebook by title when get() fails."""
    from conftest import RPCError

    mock_client = AsyncMock()
    mock_client.notebooks.get.side_effect = RPCError("not found")

    existing_nb = MagicMock()
    existing_nb.id = "found-id-789"
    existing_nb.title = "My Docs"
    mock_client.notebooks.list.return_value = [existing_nb]

    from notebooklm_add_urls import resolve_notebook

    nb_id, nb_title = await resolve_notebook(mock_client, "My Docs")

    assert nb_id == "found-id-789"
    assert nb_title == "My Docs"
    mock_client.notebooks.create.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_notebook_finds_by_title_case_insensitive():
    """resolve_notebook should match title case-insensitively."""
    from conftest import RPCError

    mock_client = AsyncMock()
    mock_client.notebooks.get.side_effect = RPCError("not found")

    existing_nb = MagicMock()
    existing_nb.id = "found-id-789"
    existing_nb.title = "My Docs"
    mock_client.notebooks.list.return_value = [existing_nb]

    from notebooklm_add_urls import resolve_notebook

    nb_id, nb_title = await resolve_notebook(mock_client, "my docs")

    assert nb_id == "found-id-789"
    assert nb_title == "My Docs"
    mock_client.notebooks.create.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_notebook_creates_new_when_no_title_match():
    """resolve_notebook should create new notebook when no title matches."""
    from conftest import RPCError

    mock_client = AsyncMock()
    mock_client.notebooks.get.side_effect = RPCError("not found")
    mock_client.notebooks.list.return_value = []
    mock_new_notebook = MagicMock()
    mock_new_notebook.id = "new-id-456"
    mock_new_notebook.title = "New Notebook"
    mock_client.notebooks.create.return_value = mock_new_notebook

    from notebooklm_add_urls import resolve_notebook

    nb_id, nb_title = await resolve_notebook(mock_client, "New Notebook")

    assert nb_id == "new-id-456"
    assert nb_title == "New Notebook"
    mock_client.notebooks.create.assert_called_once_with(title="New Notebook")


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
