/**
 * Firecrawl client utility
 * Provides client instances initialized with global configuration
 */

import type { FirecrawlClientOptions } from '@mendable/firecrawl-js';
import Firecrawl from '@mendable/firecrawl-js';
import { type GlobalConfig, getConfig, updateConfig } from './config';

/**
 * Create a Firecrawl client instance
 * Uses global configuration if available, otherwise creates with provided options
 *
 * @deprecated Use DI container instead: `container.getFirecrawlClient()`
 * This function will be removed in Phase 4 after all commands are migrated.
 */
export function getClient(
  options?: Partial<FirecrawlClientOptions>
): Firecrawl {
  // Helper to convert null to undefined and ensure we have a string or undefined
  const normalizeApiKey = (
    value: string | null | undefined
  ): string | undefined =>
    value === null || value === undefined ? undefined : value;

  // If options provided, update global config and create a new instance
  if (options) {
    // Update global config with provided options (for future calls)
    // Only include properties that are explicitly provided (not undefined)
    const configUpdate: Partial<GlobalConfig> = {};
    if (options.apiKey !== undefined) {
      configUpdate.apiKey = normalizeApiKey(options.apiKey);
    }
    if (options.apiUrl !== undefined) {
      configUpdate.apiUrl = normalizeApiKey(options.apiUrl);
    }
    if (options.timeoutMs !== undefined) {
      configUpdate.timeoutMs = options.timeoutMs;
    }
    if (options.maxRetries !== undefined) {
      configUpdate.maxRetries = options.maxRetries;
    }
    if (options.backoffFactor !== undefined) {
      configUpdate.backoffFactor = options.backoffFactor;
    }

    if (Object.keys(configUpdate).length > 0) {
      updateConfig(configUpdate);
    }

    const config = getConfig();
    const apiKey = normalizeApiKey(options.apiKey) ?? config.apiKey;
    const apiUrl = normalizeApiKey(options.apiUrl) ?? config.apiUrl;

    // Normalize apiKey for validation (convert null to undefined)
    const normalizedApiKey = apiKey === null ? undefined : apiKey;

    // Validate API key
    if (!normalizedApiKey) {
      throw new Error(
        'API key is required. Set FIRECRAWL_API_KEY environment variable, use --api-key flag, or run "firecrawl config" to set the API key.'
      );
    }

    const clientOptions: FirecrawlClientOptions = {
      apiKey: normalizedApiKey || undefined,
      apiUrl: apiUrl === null ? undefined : apiUrl,
      timeoutMs: options.timeoutMs ?? config.timeoutMs,
      maxRetries: options.maxRetries ?? config.maxRetries,
      backoffFactor: options.backoffFactor ?? config.backoffFactor,
    };

    return new Firecrawl(clientOptions);
  }

  // Create client from global config
  const config = getConfig();

  // Validate API key
  if (!config.apiKey) {
    throw new Error(
      'API key is required. Set FIRECRAWL_API_KEY environment variable, use --api-key flag, or run "firecrawl config" to set the API key.'
    );
  }

  const clientOptions: FirecrawlClientOptions = {
    apiKey: config.apiKey || undefined,
    apiUrl: config.apiUrl || undefined,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    backoffFactor: config.backoffFactor,
  };

  return new Firecrawl(clientOptions);
}
