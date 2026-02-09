/**
 * Config command implementation
 * Handles configuration and authentication
 */

import { isAuthenticated } from '../utils/auth';
import { DEFAULT_EXCLUDE_EXTENSIONS } from '../utils/constants';
import { getConfigDirectoryPath, loadCredentials } from '../utils/credentials';
import { DEFAULT_API_URL } from '../utils/defaults';
import { clearSetting, loadSettings, saveSettings } from '../utils/settings';
import { fmt, icons } from '../utils/theme';

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
    fmt.dim('To re-authenticate, run: firecrawl logout && firecrawl config\n')
  );
}

/**
 * View current configuration (read-only)
 */
export async function viewConfig(): Promise<void> {
  const credentials = loadCredentials();

  console.log('');
  console.log(fmt.bold('Firecrawl Configuration'));
  console.log('');

  if (isAuthenticated()) {
    let maskedKey = 'Not set';
    if (credentials?.apiKey) {
      const key = credentials.apiKey;
      // Only mask if key is long enough to safely show prefix/suffix
      if (key.length >= 16) {
        maskedKey = `${key.substring(0, 6)}...${key.slice(-4)}`;
      } else {
        // For short keys, show minimal information
        maskedKey = '*'.repeat(Math.min(key.length, 8));
      }
    }

    console.log(`${fmt.success(icons.success)} Authenticated`);
    console.log('');
    console.log(`  ${fmt.dim('API Key:')}  ${maskedKey}`);
    console.log(
      `  ${fmt.dim('API URL:')}  ${credentials?.apiUrl || DEFAULT_API_URL}`
    );
    console.log(`  ${fmt.dim('Config:')}   ${getConfigDirectoryPath()}`);

    // Show settings
    const settings = loadSettings();
    if (
      settings.defaultExcludePaths &&
      settings.defaultExcludePaths.length > 0
    ) {
      console.log('');
      console.log(
        `  ${fmt.dim('Exclude Paths:')} ${settings.defaultExcludePaths.join(', ')}`
      );
    }
    if (
      settings.defaultExcludeExtensions &&
      settings.defaultExcludeExtensions.length > 0
    ) {
      console.log(
        `  ${fmt.dim('Exclude Extensions:')} ${settings.defaultExcludeExtensions.join(', ')}`
      );
    }

    console.log('');
    console.log(fmt.dim('Commands:'));
    console.log(fmt.dim('  firecrawl logout       Clear credentials'));
    console.log(fmt.dim('  firecrawl config       Re-authenticate'));
  } else {
    console.log(`${fmt.warning(icons.pending)} Not authenticated`);
    console.log('');
    console.log(fmt.dim('Run any command to start authentication, or use:'));
    console.log(
      fmt.dim('  firecrawl config    Authenticate with browser or API key')
    );
  }
  console.log('');
}

/**
 * Handle config set <key> <value>
 */
export function handleConfigSet(key: string, value: string): void {
  if (key !== 'exclude-paths' && key !== 'exclude-extensions') {
    console.error(fmt.error(`Unknown setting "${key}".`));
    console.error(
      fmt.dim('Available settings: exclude-paths, exclude-extensions')
    );
    process.exit(1);
  }

  const values = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  if (values.length === 0) {
    console.error(fmt.error(`No ${key} provided.`));
    process.exit(1);
  }

  if (key === 'exclude-paths') {
    saveSettings({ defaultExcludePaths: values });
    console.log(
      `${icons.success} Default exclude paths set: ${values.join(', ')}`
    );
  } else if (key === 'exclude-extensions') {
    saveSettings({ defaultExcludeExtensions: values });
    console.log(
      `${icons.success} Default exclude extensions set: ${values.join(', ')}`
    );
  }
}

/**
 * Handle config get <key>
 */
export function handleConfigGet(key: string): void {
  if (
    key !== 'exclude-paths' &&
    key !== 'exclude-extensions' &&
    key !== 'excludes'
  ) {
    console.error(fmt.error(`Unknown setting "${key}".`));
    console.error(
      fmt.dim('Available settings: exclude-paths, exclude-extensions, excludes')
    );
    process.exit(1);
  }

  const settings = loadSettings();

  if (key === 'exclude-paths') {
    const paths = settings.defaultExcludePaths;
    if (!paths || paths.length === 0) {
      console.log(fmt.dim('No default exclude paths configured.'));
    } else {
      console.log(`${icons.bullet} Default exclude paths: ${paths.join(', ')}`);
    }
  } else if (key === 'exclude-extensions') {
    const extensions = settings.defaultExcludeExtensions;
    if (!extensions || extensions.length === 0) {
      console.log(
        fmt.dim(
          'No default exclude extensions configured (using built-in defaults).'
        )
      );
    } else {
      console.log(
        `${icons.bullet} Default exclude extensions: ${extensions.join(', ')}`
      );
    }
  } else if (key === 'excludes') {
    // Combined view of both paths and extensions
    const paths = settings.defaultExcludePaths;
    const extensions = settings.defaultExcludeExtensions;
    const activeExtensions =
      extensions && extensions.length > 0
        ? extensions
        : DEFAULT_EXCLUDE_EXTENSIONS;

    console.log('');
    console.log(fmt.bold('Exclude Configuration'));
    console.log('');

    // Show paths
    console.log(fmt.primary('Paths:'));
    if (!paths || paths.length === 0) {
      console.log(fmt.dim('  No custom exclude paths configured'));
    } else {
      console.log(`  ${paths.join(', ')}`);
    }

    console.log('');

    // Show extensions with categories
    console.log(fmt.primary('Extensions:'));
    if (extensions && extensions.length > 0) {
      console.log(fmt.dim('  (custom configuration)'));
      console.log(`  ${extensions.join(', ')}`);
    } else {
      console.log(fmt.dim('  (using built-in defaults)'));

      // Group by category
      const executables = activeExtensions.filter((e) =>
        ['.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm'].includes(e)
      );
      const archives = activeExtensions.filter((e) =>
        ['.zip', '.tar', '.gz', '.bz2', '.7z', '.rar'].includes(e)
      );
      const media = activeExtensions.filter(
        (e) =>
          ![...executables, ...archives, '.ttf', '.woff', '.woff2'].includes(e)
      );
      const fonts = activeExtensions.filter((e) =>
        ['.ttf', '.woff', '.woff2'].includes(e)
      );

      if (executables.length > 0) {
        console.log(`  ${fmt.dim('Executables:')} ${executables.join(', ')}`);
      }
      if (archives.length > 0) {
        console.log(`  ${fmt.dim('Archives:')} ${archives.join(', ')}`);
      }
      if (media.length > 0) {
        console.log(`  ${fmt.dim('Media:')} ${media.join(', ')}`);
      }
      if (fonts.length > 0) {
        console.log(`  ${fmt.dim('Fonts:')} ${fonts.join(', ')}`);
      }
    }

    console.log('');
  }
}

/**
 * Handle config clear <key>
 */
export function handleConfigClear(key: string): void {
  if (key !== 'exclude-paths' && key !== 'exclude-extensions') {
    console.error(fmt.error(`Unknown setting "${key}".`));
    console.error(
      fmt.dim('Available settings: exclude-paths, exclude-extensions')
    );
    process.exit(1);
  }

  if (key === 'exclude-paths') {
    clearSetting('defaultExcludePaths');
    console.log(`${icons.success} Default exclude paths cleared.`);
  } else if (key === 'exclude-extensions') {
    clearSetting('defaultExcludeExtensions');
    console.log(
      `${icons.success} Default exclude extensions cleared (will use built-in defaults).`
    );
  }
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
    .option(
      '--api-url <url>',
      'API URL (default: https://api.firecrawl.dev)',
      'https://api.firecrawl.dev'
    )
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

/**
 * Create and configure the view-config command
 */
export function createViewConfigCommand(): Command {
  const viewConfigCmd = new Command('view-config')
    .description('View current configuration and authentication status')
    .action(async () => {
      await viewConfig();
    });

  return viewConfigCmd;
}
