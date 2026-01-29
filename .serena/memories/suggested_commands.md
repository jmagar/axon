# Suggested Commands

## Development Commands

### Build and Compilation
```bash
pnpm build          # Compile TypeScript to JavaScript (output to dist/)
pnpm dev            # Watch mode - recompile on file changes
pnpm clean          # Remove dist/ directory
```

### Code Quality
```bash
pnpm format         # Format code with Prettier
pnpm format:check   # Check formatting without modifying files
pnpm type-check     # Run TypeScript compiler without emitting files
```

### Testing
```bash
pnpm test           # Run all tests (326 tests, ~800ms)
pnpm test:watch     # Run tests in watch mode
```

### Running Locally
```bash
pnpm start          # Run the compiled CLI (requires pnpm build first)
pnpm local          # Alias for pnpm start
node dist/index.js  # Direct invocation

# Development workflow
pnpm build && pnpm local -- scrape https://example.com
```

### Publishing (NPM)
```bash
pnpm publish-beta   # Publish beta version to NPM
pnpm publish-prod   # Publish production version to NPM (public access)
```

## Git Workflow

### Standard Git Commands
```bash
git status                    # Check current status
git add <files>              # Stage changes
git commit -m "message"      # Commit changes
git push origin <branch>     # Push to remote
git pull origin <branch>     # Pull from remote
git checkout -b <branch>     # Create and switch to new branch
git branch                   # List branches
```

### Husky Pre-commit Hooks
The project uses Husky with lint-staged:
- Automatically formats `.ts`, `.json`, `.md` files on commit
- Runs via `lint-staged` configured in `package.json`

## System Commands (Linux)

### File Operations
```bash
ls -la                  # List files with details
cat <file>             # Display file contents
grep -r "pattern" .    # Search for pattern recursively
find . -name "*.ts"    # Find files by name
mkdir -p <path>        # Create directory (with parents)
rm -rf <path>          # Remove directory recursively
cp -r <src> <dest>    # Copy recursively
```

### Process Management
```bash
ps aux | grep node     # Find Node processes
kill -9 <PID>         # Force kill process
pkill -f "pattern"    # Kill processes by pattern
```

### Port Checking
```bash
lsof -i :53002        # Check what's using port 53002
ss -tuln | grep :53002 # Alternative port check
netstat -tuln         # List all listening ports
```

### Environment Variables
```bash
env                    # List all environment variables
echo $FIRECRAWL_API_KEY  # Check specific variable
export VAR=value       # Set environment variable
source .env            # Load .env file (requires dotenv or similar)
```

## CLI Usage Examples

### Basic Scraping
```bash
firecrawl https://example.com
firecrawl scrape https://example.com --format markdown,links
firecrawl scrape https://example.com -o output.md
```

### Crawling
```bash
firecrawl crawl https://example.com --wait --progress
firecrawl crawl https://example.com --limit 100 --max-depth 3
```

### Semantic Search
```bash
firecrawl query "authentication methods" --limit 10
firecrawl retrieve https://example.com
```

### Configuration
```bash
firecrawl config       # Show current configuration
firecrawl --status     # Show version and auth status
firecrawl login        # Authenticate interactively
firecrawl logout       # Remove credentials
```

## Package Management

### pnpm Commands
```bash
pnpm install           # Install dependencies
pnpm add <package>     # Add dependency
pnpm add -D <package>  # Add dev dependency
pnpm remove <package>  # Remove dependency
pnpm update            # Update dependencies
pnpm outdated          # Check for outdated packages
pnpm list --depth=0    # List top-level dependencies
```

## Docker (If Used)

The project has a `docker-compose.yaml` file. Useful commands:

```bash
docker compose up -d              # Start services in background
docker compose down               # Stop services
docker compose ps                 # List running services
docker compose logs <service>     # View logs
docker compose restart <service>  # Restart service
```
