/**
 * Daemon Container Factory
 * Creates DI containers for background daemon processes
 *
 * Unlike the standard ContainerFactory which uses priority resolution
 * (options > env > stored credentials > defaults), the daemon factory
 * only uses environment variables and provided overrides.
 *
 * This ensures daemon processes are fully configured via environment
 * and don't depend on user credential files.
 */

import { loadCredentials } from '../utils/credentials';
import { Container } from './Container';
import type { ConfigOptions, IContainer, ImmutableConfig } from './types';

/** Default API URL */
const DEFAULT_API_URL = 'https://api.firecrawl.dev';

/** Default User Agent */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Default Qdrant collection name */
const DEFAULT_QDRANT_COLLECTION = 'firecrawl_collection';

/**
 * Create a new container for daemon processes
 *
 * Priority order:
 * 1. Provided overrides (highest)
 * 2. Environment variables
 * 3. Stored credentials (for API key fallback)
 * 4. Defaults (lowest)
 *
 * @param overrides Configuration overrides
 * @returns New container instance with immutable config
 */
export function createDaemonContainer(
  overrides: ConfigOptions = {}
): IContainer {
  // Load stored credentials for API key fallback
  const storedCredentials = loadCredentials();

  // Parse and validate embedder webhook port from environment variable
  let embedderWebhookPortFromEnv: number | undefined;
  if (process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT) {
    const parsed = Number.parseInt(
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT,
      10
    );
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
      embedderWebhookPortFromEnv = parsed;
    } else {
      console.warn(
        `[DaemonContainer] Invalid FIRECRAWL_EMBEDDER_WEBHOOK_PORT: ${process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT} (must be 1-65535)`
      );
    }
  }

  // Validate embedder webhook port from overrides
  let embedderWebhookPort: number | undefined = overrides.embedderWebhookPort;
  if (embedderWebhookPort !== undefined) {
    if (
      !Number.isFinite(embedderWebhookPort) ||
      embedderWebhookPort <= 0 ||
      embedderWebhookPort >= 65536
    ) {
      console.warn(
        `[DaemonContainer] Invalid embedderWebhookPort override: ${embedderWebhookPort} (must be 1-65535), clearing invalid value`
      );
      embedderWebhookPort = undefined;
    }
  }

  // Use validated override if available, otherwise use validated env var
  embedderWebhookPort = embedderWebhookPort || embedderWebhookPortFromEnv;

  // Resolve configuration with priority: overrides > env > stored > defaults
  const config: ImmutableConfig = {
    // Firecrawl API
    apiKey:
      overrides.apiKey ||
      process.env.FIRECRAWL_API_KEY ||
      storedCredentials?.apiKey,
    apiUrl:
      overrides.apiUrl ||
      process.env.FIRECRAWL_API_URL ||
      storedCredentials?.apiUrl ||
      DEFAULT_API_URL,
    timeoutMs: overrides.timeoutMs,
    maxRetries: overrides.maxRetries,
    backoffFactor: overrides.backoffFactor,
    userAgent:
      overrides.userAgent ||
      process.env.FIRECRAWL_USER_AGENT ||
      DEFAULT_USER_AGENT,

    // Embeddings
    teiUrl: overrides.teiUrl || process.env.TEI_URL,
    qdrantUrl: overrides.qdrantUrl || process.env.QDRANT_URL,
    qdrantCollection:
      overrides.qdrantCollection ||
      process.env.QDRANT_COLLECTION ||
      DEFAULT_QDRANT_COLLECTION,

    // Webhook
    embedderWebhookUrl:
      overrides.embedderWebhookUrl ||
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL,
    embedderWebhookSecret:
      overrides.embedderWebhookSecret ||
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_SECRET,
    embedderWebhookPort,
    embedderWebhookPath:
      overrides.embedderWebhookPath ||
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PATH,
  };

  return new Container(config);
}
