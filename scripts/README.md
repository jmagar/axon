# Scripts Directory

Utility scripts for maintaining and analyzing the CLI Firecrawl project.

## Available Scripts

### extract-base-urls.sh

Extract all unique base URLs from the Qdrant vector database.

**Usage:**
```bash
./scripts/extract-base-urls.sh [OPTIONS]
```

**Options:**
- `-o, --output FILE` - Output file path (default: `.cache/indexed-base-urls.txt`)
- `-u, --qdrant-url URL` - Qdrant URL (default: `http://localhost:53333`)
- `-c, --collection NAME` - Collection name (default: `firecrawl`)
- `-b, --batch-size N` - Batch size for scrolling (default: `10000`)
- `-q, --quiet` - Suppress progress messages
- `-h, --help` - Show help message

**Examples:**
```bash
# Basic usage
./scripts/extract-base-urls.sh

# Save to custom location
./scripts/extract-base-urls.sh -o my-urls.txt

# Quiet mode (only show summary)
./scripts/extract-base-urls.sh -q

# Connect to remote Qdrant instance
./scripts/extract-base-urls.sh --qdrant-url http://remote-host:6333
```

**What it does:**
- Connects to the Qdrant vector database
- Scrolls through all points in the collection
- Extracts the URL from each document's payload
- Converts full URLs to base URLs (protocol + hostname)
- Deduplicates and sorts the results
- Outputs statistics and the top 10 domains

**Output:**
- Creates a sorted list of unique base URLs
- Shows total points processed, unique URLs, and duplicates
- Lists the top 10 domains for quick reference

### check-qdrant-quality.ts

TypeScript utility for checking the quality of embedded documents in Qdrant.

**Usage:**
```bash
pnpm tsx scripts/check-qdrant-quality.ts
```

### test-e2e.sh

Run end-to-end tests for the CLI.

**Usage:**
```bash
./scripts/test-e2e.sh
```

## Requirements

Scripts in this directory may require:
- **bash** - Shell scripting (most scripts)
- **curl** - HTTP requests
- **jq** - JSON parsing
- **tsx** - TypeScript execution (for `.ts` scripts)
- **Docker** - Running infrastructure (Qdrant, etc.)

## Adding New Scripts

When adding new scripts:
1. Use descriptive kebab-case names: `script-name.sh` or `script-name.ts`
2. Make shell scripts executable: `chmod +x scripts/script-name.sh`
3. Add a shebang line: `#!/bin/bash` or `#!/usr/bin/env node`
4. Include usage documentation in the script header
5. Update this README with the new script's documentation
6. Follow the project's code standards (see `CLAUDE.md`)
