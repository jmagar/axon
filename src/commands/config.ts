/**
 * Config command implementation
 * Handles configuration and authentication
 */

import packageJson from '../../package.json';
import { getAuthSource, isAuthenticated } from '../utils/auth';
import { DEFAULT_EXCLUDE_EXTENSIONS } from '../utils/constants';
import { getConfigDirectoryPath, loadCredentials } from '../utils/credentials';
import { DEFAULT_API_URL, DEFAULT_QDRANT_COLLECTION } from '../utils/defaults';
import { clearSetting, loadSettings, saveSettings } from '../utils/settings';
import { colorize, colors, fmt, icons } from '../utils/theme';

export interface ConfigureOptions {
  apiKey?: string;
  apiUrl?: string;
  json?: boolean;
}

const COMMAND_DEFAULTS: Record<string, Record<string, string>> = {
  scrape: {
    formats: 'markdown',
    onlyMainContent: 'true',
    timeoutSeconds: '15',
    excludeTags: 'nav,footer',
    autoEmbed: 'true',
  },
  crawl: {
    wait: 'false',
    progress: 'false',
    pollIntervalSeconds: '5 (when --wait/--progress)',
    maxDepth: '3',
    sitemap: 'include',
    ignoreQueryParameters: 'true',
    allowSubdomains: 'true',
    onlyMainContent: 'true',
    excludeTags: 'nav,footer',
    autoEmbed: 'true',
  },
  map: {
    wait: 'false',
    sitemap: 'include',
    includeSubdomains: 'auto (defer to API)',
    ignoreQueryParameters: 'auto (defer to API)',
    ignoreCache: 'auto (defer to API)',
    filtering: 'enabled',
    defaultExcludes: 'enabled',
  },
  search: {
    limit: '5',
    sources: 'web',
    timeoutMs: '60000',
    ignoreInvalidUrls: 'true',
    scrape: 'true',
    scrapeFormats: 'markdown',
    onlyMainContent: 'true',
    autoEmbed: 'true',
  },
  extract: {
    allowExternalLinks: 'false',
    enableWebSearch: 'true',
    includeSubdomains: 'true',
    showSources: 'true',
    ignoreInvalidUrls: 'true',
    autoEmbed: 'true',
  },
};

// EnvItem stores the raw value from the environment. Sensitive values (masked: true)
// are only masked at display time — raw values are needed for config validation and
// diagnostics. This is safe because the CLI process is short-lived and single-user.
type EnvItem = {
  key: string;
  value: string;
  masked?: boolean;
  warning?: string;
};

type RuntimeEnvJsonItem = {
  value: string;
  masked: boolean;
  warning?: string;
};

type ConfigDiagnostics = {
  authenticated: boolean;
  authSource: 'explicit' | 'env' | 'stored' | 'none';
  authSourceLabel: string;
  apiKeyMasked: string;
  apiUrl: string;
  configPath: string;
  settings: {
    excludePaths: string[];
    excludeExtensions: string[];
  };
  commandDefaults: Record<string, Record<string, string>>;
  runtimeEnvironment: Record<string, RuntimeEnvJsonItem>;
};

function maskValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === 'Not set') return 'Not set';
  if (trimmed.length >= 16) {
    return `${trimmed.substring(0, 6)}...${trimmed.slice(-4)}`;
  }
  return '*'.repeat(Math.min(trimmed.length, 8));
}

function presentValue(value: string | undefined): string {
  if (!value || value.trim().length === 0) return 'Not set';
  return value.trim();
}

function buildRuntimeEnvItems(): EnvItem[] {
  const openAiModel = process.env.OPENAI_MODEL;
  const qdrantCollection = presentValue(process.env.QDRANT_COLLECTION);

  return [
    { key: 'ASK_CLI', value: presentValue(process.env.ASK_CLI) },
    {
      key: 'SEARXNG_ENDPOINT',
      value: presentValue(process.env.SEARXNG_ENDPOINT),
    },
    {
      key: 'SEARXNG_ENGINES',
      value: presentValue(process.env.SEARXNG_ENGINES),
    },
    {
      key: 'SEARXNG_CATEGORIES',
      value: presentValue(process.env.SEARXNG_CATEGORIES),
    },
    {
      key: 'OPENAI_API_KEY',
      value: presentValue(process.env.OPENAI_API_KEY),
      masked: true,
    },
    {
      key: 'OPENAI_BASE_URL',
      value: presentValue(process.env.OPENAI_BASE_URL),
    },
    {
      key: 'OPENAI_MODEL',
      value: presentValue(openAiModel),
    },
    {
      key: 'FIRECRAWL_EMBEDDER_WEBHOOK_URL',
      value: presentValue(process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL),
    },
    {
      key: 'FIRECRAWL_EMBEDDER_WEBHOOK_SECRET',
      value: presentValue(process.env.FIRECRAWL_EMBEDDER_WEBHOOK_SECRET),
      masked: true,
    },
    { key: 'FIRECRAWL_HOME', value: presentValue(process.env.FIRECRAWL_HOME) },
    {
      key: 'QDRANT_DATA_DIR',
      value: presentValue(process.env.QDRANT_DATA_DIR),
    },
    { key: 'REDIS_URL', value: presentValue(process.env.REDIS_URL) },
    {
      key: 'REDIS_RATE_LIMIT_URL',
      value: presentValue(process.env.REDIS_RATE_LIMIT_URL),
    },
    {
      key: 'PLAYWRIGHT_MICROSERVICE_URL',
      value: presentValue(process.env.PLAYWRIGHT_MICROSERVICE_URL),
    },
    {
      key: 'NUQ_RABBITMQ_URL',
      value: presentValue(process.env.NUQ_RABBITMQ_URL),
    },
    { key: 'POSTGRES_USER', value: presentValue(process.env.POSTGRES_USER) },
    {
      key: 'POSTGRES_PASSWORD',
      value: presentValue(process.env.POSTGRES_PASSWORD),
      masked: true,
    },
    { key: 'POSTGRES_DB', value: presentValue(process.env.POSTGRES_DB) },
    { key: 'POSTGRES_HOST', value: presentValue(process.env.POSTGRES_HOST) },
    { key: 'POSTGRES_PORT', value: presentValue(process.env.POSTGRES_PORT) },
    { key: 'TEI_URL', value: presentValue(process.env.TEI_URL) },
    { key: 'QDRANT_URL', value: presentValue(process.env.QDRANT_URL) },
    {
      key: 'QDRANT_COLLECTION',
      value:
        qdrantCollection === 'Not set'
          ? DEFAULT_QDRANT_COLLECTION
          : qdrantCollection,
    },
  ];
}

function printCommandDefaults(): void {
  console.log('');
  console.log(fmt.bold(colorize(colors.primary, 'Command Defaults')));
  for (const [command, defaults] of Object.entries(COMMAND_DEFAULTS)) {
    console.log(`  ${fmt.dim(`${command}:`)}`);
    for (const [key, value] of Object.entries(defaults)) {
      console.log(`    ${fmt.dim(`${key}:`)} ${value}`);
    }
  }
}

function printRuntimeEnvironment(): void {
  console.log('');
  console.log(fmt.bold(colorize(colors.primary, 'Runtime Environment')));
  for (const item of buildRuntimeEnvItems()) {
    const value = item.masked ? maskValue(item.value) : item.value;
    const warning = item.warning ? ` ${fmt.warning(`(${item.warning})`)}` : '';
    console.log(`  ${fmt.dim(`${item.key}:`)} ${value}${warning}`);
  }
}

function getAuthSourceLabel(
  authSource: 'explicit' | 'env' | 'stored' | 'none'
): string {
  if (authSource === 'env') return 'via FIRECRAWL_API_KEY';
  if (authSource === 'stored') return 'via stored credentials';
  if (authSource === 'explicit') return 'via --api-key';
  return '';
}

function buildConfigDiagnostics(): ConfigDiagnostics {
  const credentials = loadCredentials();
  const authSource = getAuthSource();
  const authenticated = isAuthenticated();
  const envApiKey =
    process.env.FIRECRAWL_API_KEY && process.env.FIRECRAWL_API_KEY.trim();
  const storedApiKey = credentials?.apiKey?.trim();
  const activeApiKey =
    authSource === 'env'
      ? envApiKey
      : authSource === 'stored'
        ? storedApiKey
        : undefined;
  const activeApiUrl =
    authSource === 'env'
      ? process.env.FIRECRAWL_API_URL || DEFAULT_API_URL
      : credentials?.apiUrl || DEFAULT_API_URL;
  const settings = loadSettings();

  const runtimeEnvironment: Record<string, RuntimeEnvJsonItem> = {};
  for (const item of buildRuntimeEnvItems()) {
    runtimeEnvironment[item.key] = {
      value: item.masked ? maskValue(item.value) : item.value,
      masked: !!item.masked,
      warning: item.warning,
    };
  }

  return {
    authenticated,
    authSource,
    authSourceLabel: getAuthSourceLabel(authSource),
    apiKeyMasked: activeApiKey ? maskValue(activeApiKey) : 'Not set',
    apiUrl: activeApiUrl,
    configPath: getConfigDirectoryPath(),
    settings: {
      excludePaths: settings.defaultExcludePaths ?? [],
      excludeExtensions: settings.defaultExcludeExtensions ?? [],
    },
    commandDefaults: COMMAND_DEFAULTS,
    runtimeEnvironment,
  };
}

/**
 * Validate setting key, throwing (via process.exit) if invalid.
 * Always returns true for valid keys; never returns false.
 */
function validateSettingKey(key: string): true {
  if (key !== 'exclude-paths' && key !== 'exclude-extensions') {
    console.error(fmt.error(`Unknown setting "${key}".`));
    console.error(
      fmt.dim('Available settings: exclude-paths, exclude-extensions')
    );
    process.exit(1);
  }
  return true;
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
  await viewConfig({ json: options.json });
  if (options.json) return;
  console.log(
    fmt.dim('To re-authenticate, run: firecrawl logout && firecrawl config\n')
  );
}

/**
 * View current configuration (read-only)
 */
export async function viewConfig(
  options: { json?: boolean } = {}
): Promise<void> {
  const diagnostics = buildConfigDiagnostics();
  if (options.json) {
    console.log(JSON.stringify(diagnostics, null, 2));
    return;
  }

  console.log('');
  console.log(
    `  ${fmt.primary(`${icons.success} firecrawl`)} ${fmt.dim('cli')} ${fmt.dim(`v${packageJson.version}`)}`
  );
  console.log('');
  console.log(`  ${fmt.bold(colorize(colors.primary, 'Configuration'))}`);
  console.log('');

  if (diagnostics.authenticated) {
    console.log(
      `  ${fmt.success(icons.active)} Authenticated${diagnostics.authSourceLabel ? ` ${fmt.dim(diagnostics.authSourceLabel)}` : ''}`
    );
    console.log('');
    console.log(
      `  ${colorize(colors.primary, 'API URL:')} ${diagnostics.apiUrl}`
    );
    console.log(`  ${fmt.dim('API Key:')} ${diagnostics.apiKeyMasked}`);
    console.log(`  ${fmt.dim('Config:')} ${diagnostics.configPath}`);

    // Show settings
    console.log('');
    console.log(fmt.bold(colorize(colors.primary, 'Settings')));
    if (diagnostics.settings.excludePaths.length > 0) {
      console.log(
        `  ${fmt.dim('Exclude Paths:')} ${diagnostics.settings.excludePaths.join(', ')}`
      );
    } else {
      console.log(`  ${fmt.dim('Exclude Paths:')} Not configured`);
    }
    if (diagnostics.settings.excludeExtensions.length > 0) {
      console.log(
        `  ${fmt.dim('Exclude Extensions:')} ${diagnostics.settings.excludeExtensions.join(', ')}`
      );
    } else {
      console.log(
        `  ${fmt.dim('Exclude Extensions:')} Not configured (using built-in defaults)`
      );
    }

    printCommandDefaults();
    printRuntimeEnvironment();

    console.log('');
    console.log(fmt.bold(colorize(colors.primary, 'Commands')));
    console.log(fmt.dim('  firecrawl logout       Clear credentials'));
    console.log(fmt.dim('  firecrawl config       Re-authenticate'));
  } else {
    console.log(`  ${fmt.error(icons.active)} Not authenticated`);
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
  validateSettingKey(key);

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
  validateSettingKey(key);

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
    .option('--json', 'Output configuration as JSON', false)
    .action(async (options) => {
      await configure({
        apiKey: options.apiKey,
        apiUrl: options.apiUrl,
        json: options.json,
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
    .option('--json', 'Output configuration as JSON', false)
    .action(async (options) => {
      await viewConfig({ json: options.json });
    });

  return viewConfigCmd;
}
