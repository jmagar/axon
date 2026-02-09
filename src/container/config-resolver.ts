import {
  DEFAULT_API_URL,
  DEFAULT_QDRANT_COLLECTION,
  DEFAULT_USER_AGENT,
} from '../utils/defaults';
import { fmt } from '../utils/theme';
import type { ConfigOptions, ImmutableConfig } from './types';

interface StoredCredentials {
  apiKey?: string;
  apiUrl?: string;
}

interface ResolveConfigOptions {
  options: ConfigOptions;
  storedCredentials?: StoredCredentials | null;
  loggerPrefix: string;
  optionLabel: string;
}

function parsePortFromEnv(loggerPrefix: string): number | undefined {
  if (!process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT) {
    return undefined;
  }

  const parsed = Number.parseInt(
    process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT,
    10
  );
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }

  console.error(
    fmt.warning(
      `[${loggerPrefix}] Invalid FIRECRAWL_EMBEDDER_WEBHOOK_PORT: ${process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT} (must be 1-65535)`
    )
  );
  return undefined;
}

function validatePortOverride(
  value: number | undefined,
  loggerPrefix: string,
  optionLabel: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value <= 0 || value >= 65536) {
    console.error(
      fmt.warning(
        `[${loggerPrefix}] Invalid embedderWebhookPort ${optionLabel}: ${value} (must be 1-65535), clearing invalid value`
      )
    );
    return undefined;
  }

  return value;
}

/**
 * Resolve immutable container config with standard priority:
 * options > env > stored credentials > defaults.
 */
export function resolveContainerConfig({
  options,
  storedCredentials,
  loggerPrefix,
  optionLabel,
}: ResolveConfigOptions): ImmutableConfig {
  const embedderWebhookPortFromEnv = parsePortFromEnv(loggerPrefix);
  const embedderWebhookPort =
    validatePortOverride(
      options.embedderWebhookPort,
      loggerPrefix,
      optionLabel
    ) || embedderWebhookPortFromEnv;

  return {
    // Firecrawl API
    apiKey:
      options.apiKey ||
      process.env.FIRECRAWL_API_KEY ||
      storedCredentials?.apiKey,
    apiUrl:
      options.apiUrl ||
      process.env.FIRECRAWL_API_URL ||
      storedCredentials?.apiUrl ||
      DEFAULT_API_URL,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    backoffFactor: options.backoffFactor,
    userAgent:
      options.userAgent ||
      process.env.FIRECRAWL_USER_AGENT ||
      DEFAULT_USER_AGENT,

    // Embeddings
    teiUrl: options.teiUrl || process.env.TEI_URL,
    qdrantUrl: options.qdrantUrl || process.env.QDRANT_URL,
    qdrantCollection:
      options.qdrantCollection ||
      process.env.QDRANT_COLLECTION ||
      DEFAULT_QDRANT_COLLECTION,

    // Webhook
    embedderWebhookUrl:
      options.embedderWebhookUrl ||
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL ||
      process.env.SELF_HOSTED_WEBHOOK_URL,
    embedderWebhookSecret:
      options.embedderWebhookSecret ||
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_SECRET ||
      process.env.SELF_HOSTED_WEBHOOK_HMAC_SECRET,
    embedderWebhookPort,
    embedderWebhookPath:
      options.embedderWebhookPath ||
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PATH,
  };
}
