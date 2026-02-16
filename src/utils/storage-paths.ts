/**
 * Unified storage paths for Axon CLI.
 *
 * Storage root can be configured via AXON_HOME.
 * Default: ~/.axon
 */

import { homedir } from 'node:os';
import * as path from 'node:path';

function expandLeadingTilde(inputPath: string): string {
  if (inputPath === '~') {
    return homedir();
  }
  if (inputPath.startsWith('~/')) {
    return path.join(homedir(), inputPath.slice(2));
  }
  return inputPath;
}

/**
 * Get the root directory for all persistent CLI storage.
 */
export function getStorageRoot(): string {
  const configuredRoot = process.env.AXON_HOME;
  if (configuredRoot && configuredRoot.trim().length > 0) {
    return path.resolve(expandLeadingTilde(configuredRoot.trim()));
  }
  return path.join(homedir(), '.axon');
}

/**
 * Build a path under the storage root.
 */
export function getStoragePath(...segments: string[]): string {
  return path.join(getStorageRoot(), ...segments);
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

export function getEmbedQueueDir(): string {
  const trimmedConfiguredDir = (
    process.env.AXON_EMBEDDER_QUEUE_DIR ||
    process.env.FIRECRAWL_EMBEDDER_QUEUE_DIR
  )?.trim();
  if (trimmedConfiguredDir) {
    return path.isAbsolute(trimmedConfiguredDir)
      ? trimmedConfiguredDir
      : path.join(process.cwd(), trimmedConfiguredDir);
  }

  return getStoragePath('embed-queue');
}
