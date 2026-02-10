# Python Tests

Unit tests for Python components in the CLI Firecrawl project.

## Running Tests

### All Tests

```bash
uv run --with pytest --with pytest-asyncio --with pydantic --with fastapi \
  --with python-dotenv --with fake-useragent --with markdownify \
  --with html-sanitizer --with requests --with patchright \
  pytest tests/ -v
```

### Specific Test File

```bash
uv run --with pytest --with pytest-asyncio --with pydantic --with fastapi \
  --with python-dotenv --with fake-useragent --with markdownify \
  --with html-sanitizer --with requests --with patchright \
  pytest tests/test_patchright_app.py -v
```

### With Coverage

```bash
uv run --with pytest --with pytest-asyncio --with pytest-cov --with pydantic \
  --with fastapi --with python-dotenv --with fake-useragent --with markdownify \
  --with html-sanitizer --with requests --with patchright \
  pytest tests/ --cov=. --cov-report=term-missing -v
```

## Test Files

- `test_patchright_app.py` - Unit tests for patchright-app.py batch scraping functionality

## Test Coverage

### test_patchright_app.py (5 tests)

1. **test_batch_scraping_multiple_urls** - Verifies all URLs in a batch are processed correctly
2. **test_batch_scraping_preserves_url_models_list** - Regression test for variable shadowing bug (url → url_item)
3. **test_batch_scraping_with_10_urls** - Tests large batch processing with 10 URLs (no truncation)
4. **test_single_url_not_affected_by_batch_logic** - Ensures single URL path works independently
5. **test_batch_with_empty_headers_uses_empty_dict** - Verifies headers default to {} when None

## Dependencies

All dependencies are managed via `uv run --with` flags:

- pytest - Testing framework
- pytest-asyncio - Async test support
- pydantic - Data validation (used by patchright-app.py)
- fastapi - Web framework (used by patchright-app.py)
- python-dotenv - Environment variable loading
- fake-useragent - User agent generation
- markdownify - HTML to Markdown conversion
- html-sanitizer - HTML sanitization
- requests - HTTP library
- patchright - Patched Playwright for web scraping

No virtual environment or separate installation required - `uv` handles everything.
