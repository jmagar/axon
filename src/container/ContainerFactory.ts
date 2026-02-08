/**
 * Container Factory
 * Creates DI containers with configuration priority resolution
 */

import { loadCredentials } from '../utils/credentials';
import { Container } from './Container';
import { resolveContainerConfig } from './config-resolver';
import type { ConfigOptions, IContainer, ImmutableConfig } from './types';

/**
 * Create a new container with configuration priority resolution
 *
 * Priority order:
 * 1. Provided options (highest)
 * 2. Environment variables
 * 3. OS credential store
 * 4. Defaults (lowest)
 *
 * @param options Configuration options
 * @returns New container instance with immutable config
 */
export function createContainer(options: ConfigOptions = {}): IContainer {
  // Load stored credentials from OS keychain/file
  const storedCredentials = loadCredentials();
  const config: ImmutableConfig = resolveContainerConfig({
    options,
    storedCredentials,
    loggerPrefix: 'Container',
    optionLabel: 'option',
  });

  return new Container(config);
}

/**
 * Create a new container with config override
 * Merges base container config with provided overrides
 *
 * Use case: Command-specific overrides (e.g., --api-key flag)
 * Creates a NEW container rather than mutating global state
 *
 * @param baseContainer Base container to inherit config from
 * @param overrides Configuration overrides
 * @returns New container instance with merged config
 */
export function createContainerWithOverride(
  baseContainer: IContainer,
  overrides: ConfigOptions
): IContainer {
  // Merge base config with overrides
  const mergedConfig: ImmutableConfig = {
    ...baseContainer.config,
    ...overrides,
  };

  return new Container(mergedConfig);
}
