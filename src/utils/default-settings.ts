import type { EffectiveUserSettings, UserSettings } from '../schemas/storage';
import { DEFAULT_EXCLUDE_EXTENSIONS, DEFAULT_EXCLUDE_PATHS } from './constants';

/**
 * Generate complete default settings object.
 * This is the single source of truth for configurable defaults.
 */
export function getDefaultSettings(): EffectiveUserSettings {
  return {
    settingsVersion: 2,
    defaultExcludePaths: [...DEFAULT_EXCLUDE_PATHS],
    defaultExcludeExtensions: [...DEFAULT_EXCLUDE_EXTENSIONS],
    crawl: {
      maxDepth: 5,
      crawlEntireDomain: true,
      allowSubdomains: true,
      onlyMainContent: true,
      excludeTags: ['nav', 'footer'],
      sitemap: 'include',
      ignoreQueryParameters: true,
      autoEmbed: true,
      pollIntervalSeconds: 5,
    },
    scrape: {
      formats: ['markdown'],
      onlyMainContent: true,
      timeoutSeconds: 15,
      excludeTags: ['nav', 'footer'],
      autoEmbed: true,
    },
    map: {
      sitemap: 'include',
      includeSubdomains: null,
      ignoreQueryParameters: true,
      ignoreCache: null,
    },
    search: {
      limit: 5,
      sources: ['web'],
      timeoutMs: 60000,
      ignoreInvalidUrls: true,
      scrape: true,
      scrapeFormats: ['markdown'],
      onlyMainContent: true,
      autoEmbed: true,
    },
    extract: {
      allowExternalLinks: false,
      enableWebSearch: true,
      includeSubdomains: true,
      showSources: true,
      ignoreInvalidUrls: true,
      autoEmbed: true,
    },
    batch: {
      onlyMainContent: false,
      ignoreInvalidUrls: false,
    },
    ask: {
      limit: 10,
    },
    http: {
      timeoutMs: 30000,
      maxRetries: 3,
      baseDelayMs: 5000,
      maxDelayMs: 60000,
    },
    chunking: {
      maxChunkSize: 1500,
      targetChunkSize: 1000,
      overlapSize: 100,
      minChunkSize: 50,
    },
    embedding: {
      maxConcurrent: 10,
      batchSize: 24,
      maxConcurrentBatches: 4,
      maxRetries: 3,
    },
    polling: {
      intervalMs: 5000,
    },
  };
}

/**
 * Deep merge user settings with defaults; user values take precedence.
 */
export function mergeWithDefaults(
  userSettings: Partial<UserSettings>
): EffectiveUserSettings {
  const defaults = getDefaultSettings();

  return {
    ...defaults,
    ...userSettings,
    defaultExcludePaths:
      userSettings.defaultExcludePaths ?? defaults.defaultExcludePaths,
    defaultExcludeExtensions:
      userSettings.defaultExcludeExtensions ??
      defaults.defaultExcludeExtensions,
    crawl: { ...defaults.crawl, ...userSettings.crawl },
    scrape: { ...defaults.scrape, ...userSettings.scrape },
    map: { ...defaults.map, ...userSettings.map },
    search: { ...defaults.search, ...userSettings.search },
    extract: { ...defaults.extract, ...userSettings.extract },
    batch: { ...defaults.batch, ...userSettings.batch },
    ask: { ...defaults.ask, ...userSettings.ask },
    http: { ...defaults.http, ...userSettings.http },
    chunking: { ...defaults.chunking, ...userSettings.chunking },
    embedding: { ...defaults.embedding, ...userSettings.embedding },
    polling: { ...defaults.polling, ...userSettings.polling },
  };
}
