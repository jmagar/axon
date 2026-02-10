/**
 * Daemon Container Factory
 * Creates DI containers for background daemon processes
 *
 * Configuration priority order:
 * 1. Provided overrides (highest)
 * 2. Environment variables
 * 3. Stored credentials (API key fallback only)
 * 4. Defaults (lowest)
 *
 * Note: Unlike interactive CLI commands, daemons prefer environment
 * configuration but will fall back to stored credentials for API keys
 * to ensure they can function when launched without explicit config.
 */

import { loadCredentials } from '../utils/credentials';
import { Container } from './Container';
import { resolveContainerConfig } from './config-resolver';
import type { ConfigOptions, IContainer, ImmutableConfig } from './types';

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
  const config: ImmutableConfig = resolveContainerConfig({
    options: overrides,
    storedCredentials,
    loggerPrefix: 'DaemonContainer',
    optionLabel: 'override',
  });

  return new Container(config);
}
