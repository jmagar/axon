/**
 * Unified storage paths for Firecrawl CLI.
 *
 * Storage root can be configured via FIRECRAWL_HOME.
 * Default: ~/.firecrawl
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

function expandLeadingTilde(inputPath: string): string {
  if (inputPath === '~') {
    return homedir();
  }
  if (inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

/**
 * Get the root directory for all persistent CLI storage.
 */
export function getStorageRoot(): string {
  const configuredRoot = process.env.FIRECRAWL_HOME;
  if (configuredRoot && configuredRoot.trim().length > 0) {
    return resolve(expandLeadingTilde(configuredRoot.trim()));
  }
  return join(homedir(), '.firecrawl');
}

/**
 * Build a path under the storage root.
 */
export function getStoragePath(...segments: string[]): string {
  return join(getStorageRoot(), ...segments);
}

/**
 * Get credentials file path in storage root.
 */
export function getCredentialsPath(): string {
  return getStoragePath('credentials.json');
}

/**
 * Get settings file path in storage root.
 */
export function getSettingsPath(): string {
  return getStoragePath('settings.json');
}

/**
 * Get job history path in storage root.
 */
export function getJobHistoryPath(): string {
  return getStoragePath('job-history.json');
}

/**
 * Resolve embed queue directory.
 *
 * Supports FIRECRAWL_EMBEDDER_QUEUE_DIR override.
 */
export function getEmbedQueueDir(): string {
  const configuredDir = process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR;
  if (configuredDir && configuredDir.trim().length > 0) {
    return configuredDir.startsWith('/')
      ? configuredDir
      : join(process.cwd(), configuredDir);
  }

  return getStoragePath('embed-queue');
}
