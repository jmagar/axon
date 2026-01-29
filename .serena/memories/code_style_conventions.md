# Code Style and Conventions

## Language Configuration

- **TypeScript Version**: 5.0+
- **Target**: ES2022
- **Module System**: CommonJS (`module: "commonjs"`)
- **Strict Mode**: Enabled (`strict: true`)
- **Source Maps**: Enabled for debugging
- **Declaration Files**: Generated for published package

## Naming Conventions

| Entity | Format | Examples |
|--------|--------|----------|
| **Files** | lowercase single word or camelCase | `config.ts`, `embedpipeline.ts`, `notebooklm.ts` |
| **Directories** | lowercase | `commands/`, `utils/`, `types/` |
| **Interfaces** | PascalCase with `I` prefix (optional) | `GlobalConfig`, `HttpOptions` |
| **Functions** | camelCase | `getApiKey()`, `handleScrapeCommand()`, `fetchWithRetry()` |
| **Constants** | UPPER_SNAKE_CASE | `DEFAULT_API_URL`, `MAX_CONCURRENT_EMBEDS`, `RETRYABLE_STATUS_CODES` |
| **Variables** | camelCase | `globalConfig`, `apiKey`, `userAgent` |

## Code Formatting (Prettier)

```json
{
  "semi": true,              // Always use semicolons
  "trailingComma": "es5",    // Trailing commas in ES5 locations
  "singleQuote": true,       // Use single quotes
  "printWidth": 80,          // Max line width 80 characters
  "tabWidth": 2,             // 2 spaces per indent
  "useTabs": false           // Use spaces, not tabs
}
```

## TypeScript Standards

### Type Safety
- **Strict Mode**: All strict checks enabled
- **Explicit Types**: Function parameters and return types should be typed
- **Interface over Type**: Prefer `interface` for object shapes
- **No `any`**: Currently 22 `any` types (technical debt to remove)
- **JSON Resolution**: `resolveJsonModule: true` for importing JSON

### Module System
- **CommonJS**: Uses `require()` and `module.exports`
- **ESM Interop**: `esModuleInterop: true` for compatibility
- **Default Imports**: Allowed via `allowSyntheticDefaultImports: true`

### Documentation
- **JSDoc Comments**: All exported functions should have JSDoc
- **Module Headers**: Each file should have a module-level JSDoc comment
- **Example Format**:
```typescript
/**
 * HTTP utilities with timeout and retry support
 *
 * Provides a wrapper around fetch with:
 * - Configurable timeout using AbortController
 * - Exponential backoff retry for transient errors
 * - Consistent error handling
 *
 * @module utils/http
 */
```

## Architecture Patterns

### Configuration Priority
1. Runtime flags (`--api-key`)
2. Environment variables (`FIRECRAWL_API_KEY`)
3. OS credential store
4. Defaults

### Error Handling
- Graceful degradation (e.g., embedding failures don't fail scraping)
- Exponential backoff for retryable errors
- Descriptive error messages with context

### Concurrency Control
- Use `p-limit` for concurrent operations
- `MAX_CONCURRENT_EMBEDS = 10` for embedding operations
- TEI batches: 24 texts, 4 concurrent requests

### Singleton Pattern
- `utils/client.ts`: Firecrawl SDK client singleton
- `utils/config.ts`: Global configuration state (note: technical debt)

### Security
- Path traversal protection on file output
- Python interpreter path validation
- 0600 file permissions for credentials
- No hardcoded secrets
