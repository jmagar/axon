/**
 * Config command implementation
 * Handles configuration and authentication
 */

import { isAuthenticated } from '../utils/auth';
import { DEFAULT_API_URL, getConfig } from '../utils/config';
import { getConfigDirectoryPath, loadCredentials } from '../utils/credentials';
import { clearSetting, loadSettings, saveSettings } from '../utils/settings';

export interface ConfigureOptions {
  apiKey?: string;
  apiUrl?: string;
}

/**
 * Configure/login - triggers login flow when not authenticated
 */
export async function configure(options: ConfigureOptions = {}): Promise<void> {
  // If not authenticated, trigger the login flow
  if (!isAuthenticated() || options.apiKey) {
    // Import handleLoginCommand to avoid circular dependency
    const { handleLoginCommand } = await import('./login');
    await handleLoginCommand({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
    });
    return;
  }

  // Already authenticated - show config and offer to re-authenticate
  await viewConfig();
  console.log(
    'To re-authenticate, run: firecrawl logout && firecrawl config\n'
  );
}

/**
 * View current configuration (read-only)
 */
export async function viewConfig(): Promise<void> {
  const credentials = loadCredentials();
  const config = getConfig();

  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│          Firecrawl Configuration        │');
  console.log('└─────────────────────────────────────────┘\n');

  if (isAuthenticated()) {
    const maskedKey = credentials?.apiKey
      ? `${credentials.apiKey.substring(0, 6)}...${credentials.apiKey.slice(-4)}`
      : 'Not set';

    console.log('Status: ✓ Authenticated\n');
    console.log(`API Key:  ${maskedKey}`);
    console.log(`API URL:  ${config.apiUrl || DEFAULT_API_URL}`);
    console.log(`Config:   ${getConfigDirectoryPath()}`);

    // Show settings
    const settings = loadSettings();
    if (
      settings.defaultExcludePaths &&
      settings.defaultExcludePaths.length > 0
    ) {
      console.log(
        `\nDefault Exclude Paths: ${settings.defaultExcludePaths.join(', ')}`
      );
    }

    console.log('\nCommands:');
    console.log('  firecrawl logout       Clear credentials');
    console.log('  firecrawl config       Re-authenticate');
  } else {
    console.log('Status: Not authenticated\n');
    console.log('Run any command to start authentication, or use:');
    console.log('  firecrawl config    Authenticate with browser or API key');
  }
  console.log('');
}

/**
 * Handle config set <key> <value>
 */
export function handleConfigSet(key: string, value: string): void {
  if (key !== 'exclude-paths') {
    console.error(`Error: Unknown setting "${key}".`);
    console.error('Available settings: exclude-paths');
    process.exit(1);
  }

  const paths = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (paths.length === 0) {
    console.error('Error: No paths provided.');
    process.exit(1);
  }

  saveSettings({ defaultExcludePaths: paths });
  console.log(`Default exclude paths set: ${paths.join(', ')}`);
}

/**
 * Handle config get <key>
 */
export function handleConfigGet(key: string): void {
  if (key !== 'exclude-paths') {
    console.error(`Error: Unknown setting "${key}".`);
    console.error('Available settings: exclude-paths');
    process.exit(1);
  }

  const settings = loadSettings();
  const paths = settings.defaultExcludePaths;

  if (!paths || paths.length === 0) {
    console.log('No default exclude paths configured.');
  } else {
    console.log(`Default exclude paths: ${paths.join(', ')}`);
  }
}

/**
 * Handle config clear <key>
 */
export function handleConfigClear(key: string): void {
  if (key !== 'exclude-paths') {
    console.error(`Error: Unknown setting "${key}".`);
    console.error('Available settings: exclude-paths');
    process.exit(1);
  }

  clearSetting('defaultExcludePaths');
  console.log('Default exclude paths cleared.');
}

import { Command } from 'commander';

/**
 * Create and configure the config command
 */
export function createConfigCommand(): Command {
  const configCmd = new Command('config')
    .description('Configure Firecrawl (login if not authenticated)')
    .option(
      '-k, --api-key <key>',
      'Provide API key directly (skips interactive flow)'
    )
    .option('--api-url <url>', 'API URL (default: https://api.firecrawl.dev)')
    .action(async (options) => {
      await configure({
        apiKey: options.apiKey,
        apiUrl: options.apiUrl,
      });
    });

  configCmd
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Setting key (e.g., exclude-paths)')
    .argument('<value>', 'Setting value (comma-separated for lists)')
    .action((key: string, value: string) => {
      handleConfigSet(key, value);
    });

  configCmd
    .command('get')
    .description('Get a configuration value')
    .argument('<key>', 'Setting key (e.g., exclude-paths)')
    .action((key: string) => {
      handleConfigGet(key);
    });

  configCmd
    .command('clear')
    .description('Clear a configuration value')
    .argument('<key>', 'Setting key (e.g., exclude-paths)')
    .action((key: string) => {
      handleConfigClear(key);
    });

  return configCmd;
}
