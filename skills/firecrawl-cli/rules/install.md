---
name: firecrawl-cli-installation
description: |
  Install the Firecrawl CLI and handle authentication errors.
---

# Firecrawl CLI Installation

## Quick Install

```bash
npm install -g firecrawl-cli
```

## Verify Installation

Check if installed and authenticated in one command:

```bash
firecrawl --version --auth-status
```

Output will show:

- Version number
- `authenticated: true` or `authenticated: false`

## Authentication

### Environment Variables (Recommended for self-hosted)

```bash
export FIRECRAWL_API_KEY="your-api-key"
export FIRECRAWL_API_URL="http://localhost:53002"  # your self-hosted URL
```

Add these to `~/.zshrc` or `~/.bashrc` for persistence.

### Interactive Login

```bash
firecrawl login
```

### Direct API Key Login

```bash
firecrawl login --api-key "your-key" --api-url "http://localhost:53002"
```

## If you fail to authenticate, use the following error handling instructions:

If ANY command returns an authentication error (e.g., "not authenticated", "unauthorized", "API key"), use an ask user question tool if available (such as the AskUserQuestion tool in Claude Code):

**Question:** "How would you like to authenticate with Firecrawl?"

**Options:**

1. **Set environment variables (Recommended)** - Set FIRECRAWL_API_KEY and FIRECRAWL_API_URL
2. **Enter API key via CLI** - Use `firecrawl login --api-key`

### If user selects environment variables:

Ask for their API key and API URL, then run:

```bash
export FIRECRAWL_API_KEY="<their-key>"
export FIRECRAWL_API_URL="<their-url>"
```

Tell them to add these exports to `~/.zshrc` or `~/.bashrc` for persistence, then retry the original command.

### If user selects CLI login:

Ask for their API key, then run:

```bash
firecrawl login --api-key "<their-key>" --api-url "<their-url>"
```

Then retry the original command.

## Embedding Pipeline Setup (Optional)

The embedding pipeline enables `embed`, `query`, and `retrieve` commands, and auto-embeds output from `scrape`, `crawl`, `search --scrape`, and `extract`.

### Requirements

- **TEI (Text Embeddings Inference)** - Generates vector embeddings
- **Qdrant** - Vector database for storage and search

### Environment Variables

```bash
export TEI_URL="http://localhost:52000"
export QDRANT_URL="http://localhost:53333"
export QDRANT_COLLECTION="firecrawl_collection"  # optional, this is the default
```

Add these to `~/.zshrc` or `~/.bashrc` for persistence alongside the Firecrawl API variables.

### Verify Services

```bash
# Check TEI is reachable
curl -s $TEI_URL/info | jq .model_id

# Check Qdrant is reachable
curl -s $QDRANT_URL/collections | jq .
```

### Without Embedding Pipeline

If TEI and Qdrant are not configured, the CLI works normally. The `scrape`, `crawl`, `search`, and `extract` commands simply skip the auto-embed step. The `embed`, `query`, and `retrieve` commands will return an error asking you to set the environment variables.

## Troubleshooting

### Command not found

If `firecrawl` command is not found after installation:

1. Make sure npm global bin is in PATH
2. Try: `npx firecrawl-cli --version`
3. Or reinstall: `npm install -g firecrawl-cli`

### Permission errors

If you get permission errors during installation:

```bash
# Option 1: Use sudo (not recommended)
sudo npm install -g firecrawl-cli

# Option 2: Fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
# Add the export to your shell profile
```
