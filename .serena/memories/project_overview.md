# CLI Firecrawl - Project Overview

## Purpose

CLI Firecrawl is a command-line interface for the Firecrawl web scraping API with integrated semantic search capabilities. It provides:
- Web scraping (single URLs and multi-page crawls)
- URL discovery (sitemap-like mapping)
- Web search with optional scraping
- Structured data extraction
- Semantic search via TEI embeddings and Qdrant vector database
- NotebookLM integration

## Tech Stack

### Core Technologies
- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.0+ (strict mode, CommonJS modules)
- **CLI Framework**: Commander.js v14
- **Package Manager**: pnpm 10.12.1
- **Testing**: Vitest v4 (326 tests across 20 test files)
- **Formatting**: Prettier v3
- **Firecrawl SDK**: @mendable/firecrawl-js v4.10+

### External Integrations (Optional)
- **TEI (Text Embeddings Inference)**: Vector embedding service
- **Qdrant**: Vector database for semantic search (default collection: firecrawl_collection)
- **NotebookLM**: Google's AI notebook via Python subprocess

### Dependencies
- **Commander.js**: CLI argument parsing
- **dotenv**: Environment variable management
- **p-limit**: Concurrency control for embeddings
- **Firecrawl SDK**: Official API client

## Repository URL
git@github.com:jmagar/firenotes.git

## Key Features
1. 13 commands: scrape, crawl, map, search, extract, embed, query, retrieve, config, login, logout, status, version
2. Automatic embedding pipeline (when TEI/Qdrant configured)
3. Graceful signal handling (SIGINT/SIGTERM)
4. HTTP retry logic with exponential backoff
5. Path traversal protection for file output
6. OS credential storage (keychain/file fallback)
