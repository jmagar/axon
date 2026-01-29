# Codebase Structure

## Directory Layout

```
cli-firecrawl/
├── src/                     # Source code (TypeScript)
│   ├── index.ts            # CLI entry point (~850 lines, Commander.js setup)
│   ├── commands/           # Command implementations (13 commands)
│   │   ├── scrape.ts      # Single URL scraping
│   │   ├── crawl.ts       # Multi-page crawling
│   │   ├── map.ts         # URL discovery
│   │   ├── search.ts      # Web search
│   │   ├── extract.ts     # Structured data extraction
│   │   ├── embed.ts       # Manual vector embedding
│   │   ├── query.ts       # Semantic search
│   │   ├── retrieve.ts    # Document reconstruction
│   │   ├── config.ts      # Configuration display
│   │   ├── login.ts       # Authentication
│   │   ├── logout.ts      # Credential removal
│   │   ├── status.ts      # System status
│   │   └── version.ts     # Version info
│   ├── utils/              # Shared utilities (15 modules)
│   │   ├── client.ts      # Firecrawl SDK singleton
│   │   ├── config.ts      # Global configuration (env > credentials > defaults)
│   │   ├── credentials.ts # OS credential storage (keychain/file fallback)
│   │   ├── auth.ts        # Authentication flow
│   │   ├── output.ts      # Output formatting with path traversal protection
│   │   ├── http.ts        # HTTP utilities with timeout and retry
│   │   ├── embedpipeline.ts # Embedding orchestration
│   │   ├── chunker.ts     # Markdown-aware text chunking
│   │   ├── embeddings.ts  # TEI integration (batched, concurrent)
│   │   ├── qdrant.ts      # Qdrant client
│   │   ├── notebooklm.ts  # NotebookLM Python integration
│   │   ├── url.ts         # URL validation
│   │   ├── options.ts     # CLI option parsing
│   │   ├── job.ts         # Job ID detection
│   │   └── settings.ts    # User settings persistence
│   ├── types/              # TypeScript interfaces (8 files)
│   │   ├── scrape.ts
│   │   ├── crawl.ts
│   │   ├── map.ts
│   │   ├── search.ts
│   │   ├── extract.ts
│   │   ├── embed.ts
│   │   ├── query.ts
│   │   └── retrieve.ts
│   └── __tests__/          # Test files (20 test files, 326 tests)
│       ├── commands/       # Command tests
│       └── utils/          # Utility tests
├── dist/                   # Compiled JavaScript (gitignored)
├── node_modules/           # Dependencies (gitignored)
├── .docs/                  # Session logs and documentation
│   ├── sessions/          # Session-specific logs
│   └── *.md               # Various project docs
├── docs/                   # User documentation
├── skills/                 # CLI skill definition (for AI agents)
├── scripts/                # Build and maintenance scripts
├── apps/                   # Deployable applications (if any)
├── .env                    # Environment variables (gitignored)
├── .env.example            # Environment variable template
├── package.json            # NPM package configuration
├── tsconfig.json           # TypeScript configuration
├── vitest.config.mjs       # Vitest test configuration
├── .prettierrc.json        # Prettier formatting rules
├── README.md               # User-facing documentation
└── CLAUDE.md               # AI agent context
```

## Build Output

- **Source**: `src/**/*.ts`
- **Output**: `dist/**/*.js`
- **Entry Point**: `dist/index.js` (executable via `firecrawl` command)

## Module Organization

- **Commands**: Each command is a separate file in `src/commands/`
- **Types**: Each command has a corresponding type definition in `src/types/`
- **Utils**: Shared utilities are modular and single-purpose
- **Tests**: Mirror the source structure in `src/__tests__/`
