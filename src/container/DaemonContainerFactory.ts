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
