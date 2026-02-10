"""
Unit tests for patchright-app.py batch scraping functionality.

Tests cover:
1. Multiple URLs processing
2. Variable shadowing regression (url vs url_item)
3. Large batch handling (10+ URLs)
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pydantic import HttpUrl
import sys
import os

# Add project root to path to import patchright-app
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

# Now we need to import the module with the hyphen by using importlib
import importlib.util
spec = importlib.util.spec_from_file_location("patchright_app", os.path.join(project_root, "patchright-app.py"))
patchright_app = importlib.util.module_from_spec(spec)
sys.modules["patchright_app"] = patchright_app
spec.loader.exec_module(patchright_app)

# Import the models and functions
MultipleUrlModel = patchright_app.MultipleUrlModel
UrlModel = patchright_app.UrlModel
scrape_page_endpoint = patchright_app.scrape_page_endpoint


@pytest.fixture
def mock_context():
    """Mock the global browser context."""
    mock_ctx = AsyncMock()
    mock_page = AsyncMock()

    # Mock page.goto response
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.header_value.return_value = "text/html"
    mock_response.body = AsyncMock(return_value=b"<html><body>Test</body></html>")

    mock_page.goto.return_value = mock_response
    mock_page.content.return_value = "<html><body>Test Content</body></html>"
    mock_ctx.new_page.return_value = mock_page

    return mock_ctx


@pytest.mark.asyncio
async def test_batch_scraping_multiple_urls(mock_context):
    """Test that all URLs in batch are processed."""
    test_urls = [
        "https://example.com/page1",
        "https://example.com/page2",
        "https://example.com/page3"
    ]

    request = MultipleUrlModel(
        urls=test_urls,
        wait_after_load=0,
        timeout=15000
    )

    with patch('patchright_app.context', mock_context):
        with patch('patchright_app.scrape_page') as mock_scrape:
            # Mock scrape_page to return unique results
            mock_scrape.side_effect = [
                {"content": f"Page {i}", "pageStatusCode": 200, "processingTime": 0.5}
                for i in range(len(test_urls))
            ]

            results = await scrape_page_endpoint(request)

            # Verify all URLs were processed
            assert len(results) == 3
            assert mock_scrape.call_count == 3

            # Verify each URL was called with correct UrlModel
            for call_idx, call_args in enumerate(mock_scrape.call_args_list):
                url_model = call_args[0][0]
                assert isinstance(url_model, UrlModel)
                assert str(url_model.url) == test_urls[call_idx]
                assert url_model.wait_after_load == 0
                assert url_model.timeout == 15000


@pytest.mark.asyncio
async def test_batch_scraping_preserves_url_models_list(mock_context):
    """Regression test for variable shadowing bug.

    Before fix: loop variable 'url' shadowed the UrlModel construction,
    causing all URL models to use the last URL in the list.

    After fix: loop variable 'url_item' prevents shadowing.
    """
    test_urls = [
        "https://example.com/first",
        "https://example.com/second",
        "https://example.com/third"
    ]

    request = MultipleUrlModel(
        urls=test_urls,
        wait_after_load=100,
        timeout=30000,
        headers={"User-Agent": "Test"}
    )

    with patch('patchright_app.context', mock_context):
        with patch('patchright_app.scrape_page') as mock_scrape:
            mock_scrape.side_effect = [
                {"content": "Content", "pageStatusCode": 200, "processingTime": 0.1}
                for _ in test_urls
            ]

            await scrape_page_endpoint(request)

            # Critical regression test: verify each call got the CORRECT URL
            # (not all the same URL due to variable shadowing)
            called_urls = []
            for call_args in mock_scrape.call_args_list:
                url_model = call_args[0][0]
                called_urls.append(str(url_model.url))

            # Each URL should appear exactly once
            assert called_urls == test_urls
            assert len(set(called_urls)) == 3  # All unique

            # Verify other params were preserved correctly
            for call_args in mock_scrape.call_args_list:
                url_model = call_args[0][0]
                assert url_model.wait_after_load == 100
                assert url_model.timeout == 30000
                assert url_model.headers == {"User-Agent": "Test"}


@pytest.mark.asyncio
async def test_batch_scraping_with_10_urls(mock_context):
    """Test large batch processing with 10 URLs.

    Verifies no truncation or data loss in larger batches.
    """
    test_urls = [f"https://example.com/page{i}" for i in range(10)]

    request = MultipleUrlModel(
        urls=test_urls,
        wait_after_load=0,
        timeout=15000
    )

    with patch('patchright_app.context', mock_context):
        with patch('patchright_app.scrape_page') as mock_scrape:
            # Mock unique responses
            mock_scrape.side_effect = [
                {
                    "content": f"Content for page {i}",
                    "pageStatusCode": 200,
                    "processingTime": 0.1 + (i * 0.01)
                }
                for i in range(10)
            ]

            results = await scrape_page_endpoint(request)

            # Verify all 10 URLs processed
            assert len(results) == 10
            assert mock_scrape.call_count == 10

            # Verify each result is unique (no duplicates from shadowing)
            processing_times = [r["processingTime"] for r in results]
            assert len(set(processing_times)) == 10  # All unique timestamps

            # Verify URL order preserved
            called_urls = [str(call[0][0].url) for call in mock_scrape.call_args_list]
            assert called_urls == test_urls


@pytest.mark.asyncio
async def test_single_url_not_affected_by_batch_logic(mock_context):
    """Verify single URL code path is unaffected by batch URL fixes."""
    test_url = "https://example.com/single"

    request = MultipleUrlModel(
        url=test_url,
        wait_after_load=500,
        timeout=20000
    )

    with patch('patchright_app.context', mock_context):
        with patch('patchright_app.scrape_page') as mock_scrape:
            mock_scrape.return_value = {
                "content": "Single page",
                "pageStatusCode": 200,
                "processingTime": 0.3
            }

            result = await scrape_page_endpoint(request)

            # Should call scrape_page once
            assert mock_scrape.call_count == 1

            # Verify UrlModel construction
            url_model = mock_scrape.call_args[0][0]
            assert str(url_model.url) == test_url
            assert url_model.wait_after_load == 500
            assert url_model.timeout == 20000

            # Result should be dict (not list)
            assert isinstance(result, dict)


@pytest.mark.asyncio
async def test_batch_with_empty_headers_uses_empty_dict(mock_context):
    """Verify headers default to {} when None."""
    test_urls = ["https://example.com/a", "https://example.com/b"]

    request = MultipleUrlModel(
        urls=test_urls,
        headers=None  # Explicitly None
    )

    with patch('patchright_app.context', mock_context):
        with patch('patchright_app.scrape_page') as mock_scrape:
            mock_scrape.side_effect = [
                {"content": "Content", "pageStatusCode": 200, "processingTime": 0.1}
                for _ in test_urls
            ]

            await scrape_page_endpoint(request)

            # Verify headers were set to {} for all calls
            for call_args in mock_scrape.call_args_list:
                url_model = call_args[0][0]
                assert url_model.headers == {}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
