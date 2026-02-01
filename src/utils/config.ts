/**
 * Global configuration system
 */

import { loadCredentials } from './credentials';

export const DEFAULT_API_URL = 'https://api.firecrawl.dev';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface GlobalConfig {
  apiKey?: string;
  apiUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffFactor?: number;
  userAgent?: string;
  teiUrl?: string;
  qdrantUrl?: string;
  qdrantCollection?: string;
  embedderWebhookUrl?: string;
  embedderWebhookSecret?: string;
  embedderWebhookPort?: number;
  embedderWebhookPath?: string;
}

/**
 * Global configuration instance
 */
let globalConfig: GlobalConfig = {};

/**
 * Initialize global configuration
 * Loads from: provided config > environment variables > OS credential storage
 * @param config Configuration options
 * @deprecated Use DI container instead: `createContainer(config)`
 * This function will be removed in Phase 4 after all commands are migrated.
 */
export function initializeConfig(config: Partial<GlobalConfig> = {}): void {
  // Priority: provided config > env vars > stored credentials
  const storedCredentials = loadCredentials();
  const embedderWebhookPort =
    config.embedderWebhookPort ??
    (process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT
      ? Number.parseInt(process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT, 10)
      : undefined);

  globalConfig = {
    apiKey:
      config.apiKey ||
      process.env.FIRECRAWL_API_KEY ||
      storedCredentials?.apiKey,
    apiUrl:
      config.apiUrl ||
      process.env.FIRECRAWL_API_URL ||
      storedCredentials?.apiUrl,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    backoffFactor: config.backoffFactor,
    teiUrl: config.teiUrl || process.env.TEI_URL,
    qdrantUrl: config.qdrantUrl || process.env.QDRANT_URL,
    userAgent:
      config.userAgent ||
      process.env.FIRECRAWL_USER_AGENT ||
      DEFAULT_USER_AGENT,
    qdrantCollection:
      config.qdrantCollection ||
      process.env.QDRANT_COLLECTION ||
      'firecrawl_collection',
    embedderWebhookUrl:
      config.embedderWebhookUrl || process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL,
    embedderWebhookSecret:
      config.embedderWebhookSecret ||
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_SECRET,
    embedderWebhookPort: Number.isFinite(embedderWebhookPort)
      ? embedderWebhookPort
      : undefined,
    embedderWebhookPath:
      config.embedderWebhookPath || process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PATH,
  };
}

/**
 * Get the current global configuration
 * @deprecated Use DI container instead: `container.config`
 * This function will be removed in Phase 4 after all commands are migrated.
 */
export function getConfig(): GlobalConfig {
  return { ...globalConfig };
}

/**
 * Update global configuration (merges with existing)
 * @deprecated Use DI container instead: `createContainerWithOverride(base, overrides)`
 * This function will be removed in Phase 4 after all commands are migrated.
 */
export function updateConfig(config: Partial<GlobalConfig>): void {
  globalConfig = {
    ...globalConfig,
    ...config,
  };
}

/**
 * Get API key from global config or provided value
 * Priority: provided key > global config > env var > stored credentials
 * @deprecated Use DI container instead: `container.config.apiKey`
 * This function will be removed in Phase 4 after all commands are migrated.
 */
export function getApiKey(providedKey?: string): string | undefined {
  if (providedKey) return providedKey;
  if (globalConfig.apiKey) return globalConfig.apiKey;
  if (process.env.FIRECRAWL_API_KEY) return process.env.FIRECRAWL_API_KEY;

  // Fallback to stored credentials if not already loaded
  const storedCredentials = loadCredentials();
  return storedCredentials?.apiKey;
}

/**
 * Validate that required configuration is present
 * @deprecated Validation is now automatic in container.getFirecrawlClient()
 * This function will be removed in Phase 4 after all commands are migrated.
 */
export function validateConfig(apiKey?: string): void {
  const key = getApiKey(apiKey);
  if (!key) {
    throw new Error(
      'API key is required. Set FIRECRAWL_API_KEY environment variable, use --api-key flag, or run "firecrawl config" to set the API key.'
    );
  }
}

/**
 * Reset global configuration (useful for testing)
 * @deprecated Use test containers instead: `createTestContainer()`
 * This function will be removed in Phase 4 after all tests are migrated.
 */
export function resetConfig(): void {
  globalConfig = {};
}
