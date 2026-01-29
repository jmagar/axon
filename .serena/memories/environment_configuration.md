# Environment Configuration

## Required Environment Variables

### Core Configuration

```bash
# Firecrawl API (Required)
FIRECRAWL_API_KEY=local-dev                    # Your Firecrawl API key
FIRECRAWL_API_URL=http://localhost:53002       # Self-hosted Firecrawl URL

# Custom User-Agent (Optional)
FIRECRAWL_USER_AGENT=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36...
```

### Embedding Pipeline (Optional)

```bash
# Text Embeddings Inference
TEI_URL=http://localhost:52000                 # TEI service URL
# NOTE: TEI runs on 52000 (exception to 53000+ port rule)

# Qdrant Vector Database
QDRANT_URL=http://localhost:53333              # Qdrant service URL
QDRANT_COLLECTION=firecrawl_collection         # Collection name (default)
```

## Configuration Priority

The CLI resolves configuration in this order (highest to lowest priority):

1. **Runtime Flags**: `--api-key`, `--api-url`
2. **Environment Variables**: `FIRECRAWL_API_KEY`, `FIRECRAWL_API_URL`, etc.
3. **OS Credential Store**: macOS Keychain, Linux Secret Service, Windows Credential Manager
4. **Fallback File**: `~/.config/firecrawl-cli/credentials.json` (0600 permissions)
5. **Defaults**: `DEFAULT_API_URL`, `DEFAULT_USER_AGENT`, etc.

## Environment Setup

### Development Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Edit `.env` with your values:
```bash
nano .env  # or vim, code, etc.
```

3. Load environment variables:
```bash
# Option 1: Auto-loaded by dotenv (in code)
# Option 2: Manually source (for shell)
export $(cat .env | xargs)
```

### Authentication Methods

#### 1. Environment Variables (Recommended for Self-Hosted)
```bash
export FIRECRAWL_API_KEY=your-key
export FIRECRAWL_API_URL=http://localhost:53002
```

#### 2. Interactive Login
```bash
firecrawl login
# Prompts for API key and URL, stores in OS credential manager
```

#### 3. Direct Login
```bash
firecrawl login --api-key your-key --api-url http://localhost:53002
```

#### 4. Per-Command
```bash
firecrawl scrape https://example.com --api-key your-key
```

### Credential Storage Locations

| Platform | Primary Storage | Fallback |
|----------|----------------|----------|
| macOS | Keychain | `~/.config/firecrawl-cli/credentials.json` |
| Linux | Secret Service | `~/.config/firecrawl-cli/credentials.json` |
| Windows | Credential Manager | `%APPDATA%/firecrawl-cli/credentials.json` |

**Fallback File Permissions**: Always 0600 (read/write for owner only)

## Optional Services

### TEI (Text Embeddings Inference)

Required for: `embed`, `query`, `retrieve` commands, and auto-embedding

**Docker Setup**:
```bash
docker run -d \
  --name tei \
  -p 52000:80 \
  -v $PWD/data:/data \
  ghcr.io/huggingface/text-embeddings-inference:latest \
  --model-id BAAI/bge-small-en-v1.5
```

**Environment**:
```bash
export TEI_URL=http://localhost:52000
```

### Qdrant Vector Database

Required for: `embed`, `query`, `retrieve` commands, and auto-embedding

**Docker Setup**:
```bash
docker run -d \
  --name qdrant \
  -p 53333:6333 \
  -v $PWD/qdrant_storage:/qdrant/storage \
  qdrant/qdrant
```

**Environment**:
```bash
export QDRANT_URL=http://localhost:53333
export QDRANT_COLLECTION=firecrawl_collection  # optional
```

### NotebookLM (Python Integration)

Required for: `map --notebook` command

**Setup**:
```bash
pip install notebooklm
notebooklm login
```

**No environment variables needed** - uses Python subprocess

## Port Assignments

Per project standards, all services must use high ports (53000+):

| Service | Port | Notes |
|---------|------|-------|
| Firecrawl API | 53002 | Self-hosted instance |
| Qdrant | 53333 | Vector database |
| TEI | 52000 | **Exception**: Pre-existing service, kept as-is |

**Important**: TEI runs on 52000 in this environment. This is an exception to the 53000+ rule and should not be changed without coordination.

## Verifying Configuration

```bash
# Check current configuration
firecrawl config

# Check status with version and auth info
firecrawl --status

# Test API connection
firecrawl scrape https://example.com --format markdown

# Test embedding pipeline (if configured)
firecrawl embed https://example.com
firecrawl query "test query"
```

## Security Best Practices

1. **Never commit `.env`**: Already in `.gitignore`
2. **Use `.env.example`**: Template for required variables
3. **Rotate API keys**: Regularly update credentials
4. **File permissions**: Credential files should be 0600
5. **No hardcoded secrets**: Always use environment variables or credential store
6. **HTTPS in production**: Use `https://` URLs for production APIs
