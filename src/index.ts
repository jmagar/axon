#!/usr/bin/env node

/**
 * Axon CLI
 * Entry point for the CLI application
 */

import { resolve } from 'node:path';
import { Command } from 'commander';
import { config as loadDotenv } from 'dotenv';

// Load the CLI project's .env by default for local/self-hosted workflows.
// Set FIRECRAWL_CLI_DISABLE_LOCAL_ENV=1 to disable this behavior.
if (process.env.FIRECRAWL_CLI_DISABLE_LOCAL_ENV !== '1') {
  const envPath = resolve(__dirname, '..', '.env');
  loadDotenv({ path: envPath, quiet: true });
}

import packageJson from '../package.json';
import { createAskCommand } from './commands/ask';
import { createBatchCommand } from './commands/batch';
import { createCompletionCommand } from './commands/completion';
import {
  createConfigCommand,
  createViewConfigCommand,
} from './commands/config';
import { createCrawlCommand } from './commands/crawl';
import { createDeleteCommand } from './commands/delete';
import { createDoctorCommand } from './commands/doctor';
import { createDomainsCommand } from './commands/domains';
import { createEmbedCommand } from './commands/embed';
import { createExtractCommand } from './commands/extract';
import { createHistoryCommand } from './commands/history';
import { createInfoCommand } from './commands/info';
import { createListCommand } from './commands/list';
import { createLoginCommand } from './commands/login';
import { createLogoutCommand } from './commands/logout';
import { createMapCommand } from './commands/map';
import { createQueryCommand } from './commands/query';
import { createReconcileCommand } from './commands/reconcile';
import { createRetrieveCommand } from './commands/retrieve';
import { createScrapeCommand } from './commands/scrape';
import { createSearchCommand } from './commands/search';
import { createSourcesCommand } from './commands/sources';
import { createStatsCommand } from './commands/stats';
import { createStatusCommand, handleStatusCommand } from './commands/status';
import { createVersionCommand } from './commands/version';
import {
  createContainer,
  createContainerWithOverride,
} from './container/ContainerFactory';
import type { IContainer } from './container/types';
import { ensureAuthenticated, printBanner } from './utils/auth';
import { colorize, colors, fmt, icons, isTTY } from './utils/theme';
import { isUrl, normalizeUrl } from './utils/url';

// Commander module augmentation (container injection)
import './types/commander';

/**
 * Dependency Injection Container
 * Phase 2: Commands receive container as first parameter.
 * This enables isolated configuration per command execution.
 */
const baseContainer: IContainer = createContainer();

/**
 * Signal handlers for graceful shutdown
 *
 * Handle SIGINT (Ctrl+C) and SIGTERM to allow cleanup and provide
 * a better user experience when interrupting long-running operations.
 */
let isShuttingDown = false;

function handleShutdown(signal: string): void {
  if (isShuttingDown) {
    // Force exit on second signal
    console.error(`\n${fmt.warning('Force exiting...')}`);
    process.exit(130);
  }

  isShuttingDown = true;
  console.error(
    `\n${fmt.dim(`${signal} received.`)} Shutting down gracefully...`
  );

  // Dispose container resources (HTTP connections, etc.) then exit
  const exitCode = signal === 'SIGINT' ? 130 : 143;
  baseContainer
    .dispose()
    .catch((error) => {
      // Log but don't block shutdown on dispose errors
      console.error(
        fmt.warning(
          `Error during cleanup: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      );
    })
    .finally(() => {
      process.exit(exitCode);
    });

  // Force exit after timeout if dispose hangs
  setTimeout(() => {
    console.error(fmt.warning('Cleanup timeout, forcing exit...'));
    process.exit(exitCode);
  }, 5000);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

const TOP_LEVEL_COMMANDS = new Set([
  'scrape',
  'crawl',
  'list',
  'status',
  'map',
  'search',
  'extract',
  'embed',
  'query',
  'reconcile',
  'retrieve',
  'ask',
  'batch',
  'config',
  'view-config',
  'login',
  'logout',
  'version',
  'doctor',
  'sources',
  'stats',
  'domains',
  'delete',
  'history',
  'info',
  'completion',
  'help',
]);

const program = new Command();
function isTopLevelHelpInvocation(): boolean {
  const nonOptionArgs = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith('-'));
  if (nonOptionArgs.length === 0) return true;
  return !TOP_LEVEL_COMMANDS.has(nonOptionArgs[0]);
}

function renderTopLevelHelp(): string {
  const globalOptions = [
    ['-V, --version', 'output the version number'],
    [
      '-k, --api-key <key>',
      'Firecrawl API key (or set FIRECRAWL_API_KEY env var)',
    ],
    ['--api-url <url>', 'Firecrawl API URL (or set FIRECRAWL_API_URL env var)'],
    ['--status', 'Show version, auth status, concurrency, and credits'],
    ['-h, --help', 'display help for command'],
  ];

  const commandGroups = [
    {
      title: 'Core Web Operations',
      commands: [
        ['scrape [url] [formats...]', 'Scrape a URL using Axon'],
        ['crawl [url-or-job-id]', 'Crawl a website using Axon'],
        ['map [url]', 'Map URLs on a website using Axon'],
        ['search <query>', 'Search the web using Axon'],
        ['extract [urls...]', 'Extract structured data from URLs'],
        ['batch [urls...]', 'Batch scrape multiple URLs'],
      ],
    },
    {
      title: 'Vector Search',
      commands: [
        ['embed [input]', 'Embed content into Qdrant vector database'],
        ['query <query>', 'Semantic search over embedded content'],
        ['reconcile', 'Inspect and control crawl reconciliation state'],
        ['retrieve <url>', 'Retrieve full document from Qdrant by URL'],
        ['ask <query>', 'Ask questions about your embedded documents'],
        ['sources', 'List all indexed source URLs'],
        ['domains', 'List unique indexed domains'],
        ['stats', 'Show vector database statistics'],
        ['history', 'Show time-based index history'],
        ['info [url]', 'Show URL details or storage paths'],
        ['delete', 'Delete vectors from the vector database'],
      ],
    },
    {
      title: 'Jobs & Account',
      commands: [
        ['list', 'List active crawl jobs'],
        ['status', 'Show active jobs and embedding queue status'],
        ['doctor', 'Run local diagnostics for service health/config'],
        ['config', 'Configure Axon (login if not authenticated)'],
        ['view-config', 'View current configuration and auth status'],
        ['login', 'Login to Axon (alias for config)'],
        ['logout', 'Logout and clear stored credentials'],
        ['version', 'Display version information'],
      ],
    },
  ];

  const optionWidth = Math.max(...globalOptions.map(([name]) => name.length));
  const commandWidth = 30;
  const formatRow = (left: string, right: string, width: number): string =>
    `  ${colorize(colors.materialLightBlue, left.padEnd(width, ' '))}  ${fmt.dim(right)}`;

  const title = fmt.bold(colorize(colors.primary, 'AXON CLI'));
  const titleRule = colorize(
    colors.primary,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  );
  const section = (text: string): string =>
    fmt.bold(colorize(colors.primary, text));
  const muted = (text: string): string => fmt.dim(text);
  const chip = (text: string): string => {
    if (!isTTY()) {
      return text;
    }
    return `${colorize(colors.materialLightBlue, `[${text}]`)}`;
  };

  const lines = [
    '',
    `  ${title}`,
    `  ${titleRule}`,
    `  ${muted(`Version ${packageJson.version}  ${icons.separator}  Turn websites into LLM-ready data`)}`,
    `  ${muted('CLI tool for Axon web scraping')}`,
    '',
    `  ${section('Usage')}`,
    `  ${chip('axon [options] [command]')}`,
    '',
    `  ${section('Quick Start')}`,
    `  ${muted('axon https://example.com markdown')}`,
    `  ${muted('axon crawl https://docs.example.com --limit 50')}`,
    `  ${muted('axon extract https://example.com --prompt "Get contact info"')}`,
    '',
    `  ${section('Global Options')}`,
    ...globalOptions.map(([left, right]) =>
      formatRow(left, right, optionWidth)
    ),
  ];

  for (const group of commandGroups) {
    lines.push('');
    lines.push(`  ${section(group.title)}`);
    lines.push(
      ...group.commands.map(([left, right]) =>
        formatRow(left, right, commandWidth)
      )
    );
  }

  lines.push('');
  lines.push(`  ${section('Examples')}`);
  lines.push(
    `  ${muted('axon scrape https://example.com markdown --output result.md')}`
  );
  lines.push(
    `  ${muted('axon map https://example.com --search docs --limit 100')}`
  );
  lines.push(`  ${muted('axon search "firecrawl blog" --limit 5 --scrape')}`);
  lines.push(
    `  ${muted('axon query "pricing and limits" --domain docs.firecrawl.dev')}`
  );
  lines.push(
    `  ${muted('axon ask "How do I use the crawl command?" --limit 3')}`
  );
  lines.push('');
  lines.push(
    `  ${muted(`${icons.arrow} Run axon <command> --help for command-specific flags`)}`
  );
  lines.push('');

  return lines.join('\n');
}

program
  .name('axon')
  .description('CLI tool for Axon web scraping')
  .version(packageJson.version)
  .option(
    '-k, --api-key <key>',
    'Firecrawl API key (or set FIRECRAWL_API_KEY env var)'
  )
  .option(
    '--api-url <url>',
    'Firecrawl API URL (or set FIRECRAWL_API_URL env var)'
  )
  .option('--status', 'Show version, auth status, concurrency, and credits')
  .allowUnknownOption() // Allow unknown options when URL is passed directly
  .hook('preAction', async (thisCommand, actionCommand) => {
    // Create container with optional API overrides
    const globalOptions = thisCommand.opts();
    let commandContainer = baseContainer;
    if (globalOptions.apiKey || globalOptions.apiUrl) {
      commandContainer = createContainerWithOverride(baseContainer, {
        apiKey: globalOptions.apiKey,
        apiUrl: globalOptions.apiUrl,
      });
    }

    // Store container on command for access in handlers
    actionCommand._container = commandContainer;

    // Check if this command requires authentication
    // Commands will handle authentication errors from the API
    // No need to enforce auth upfront - let the API return 401 if needed
  });

// Add scrape command to main program
program.addCommand(createScrapeCommand());

/**
 * Create and configure the map command
 */

// Add crawl, map, and search commands to main program
program.addCommand(createCrawlCommand());
program.addCommand(createListCommand());
program.addCommand(createStatusCommand());
program.addCommand(createMapCommand());
program.addCommand(createSearchCommand());

// Add extract, embed, query, retrieve, and ask commands to main program
program.addCommand(createExtractCommand());
program.addCommand(createEmbedCommand());
program.addCommand(createQueryCommand());
program.addCommand(createReconcileCommand());
program.addCommand(createRetrieveCommand());
program.addCommand(createAskCommand());
program.addCommand(createBatchCommand());

program.addCommand(createConfigCommand());

program.addCommand(createViewConfigCommand());

program.addCommand(createLoginCommand());

program.addCommand(createLogoutCommand());

program.addCommand(createVersionCommand());

program.addCommand(createSourcesCommand());
program.addCommand(createDoctorCommand());
program.addCommand(createStatsCommand());
program.addCommand(createDomainsCommand());
program.addCommand(createDeleteCommand());
program.addCommand(createHistoryCommand());
program.addCommand(createInfoCommand());
program.addCommand(createCompletionCommand());

// Parse arguments
const args = process.argv.slice(2);

// Handle the main entry point
async function main() {
  // Handle --version with --auth-status before Commander processes it
  // Commander's built-in --version handler doesn't support additional flags
  const hasVersion = args.includes('--version') || args.includes('-V');
  const hasAuthStatus = args.includes('--auth-status');

  if (hasVersion && hasAuthStatus) {
    const { isAuthenticated } = await import('./utils/auth');
    console.log('');
    console.log(`  ${fmt.primary('Version:')} ${fmt.dim(packageJson.version)}`);
    console.log(
      `  ${fmt.primary('Authenticated:')} ${
        isAuthenticated()
          ? fmt.success(`${icons.success} true`)
          : fmt.error(`${icons.error} false`)
      }`
    );
    console.log('');
    return;
  }

  // Handle --status flag
  if (args.includes('--status')) {
    await handleStatusCommand(baseContainer, {});
    return;
  }

  // Handle top-level help with custom formatted output
  // Keep subcommand help delegated to Commander.
  const hasHelpFlag = args.includes('--help') || args.includes('-h');
  const isRootHelpCommand =
    args[0] === 'help' &&
    (args.length === 1 || args[1] === '--help' || args[1] === '-h');
  if (isRootHelpCommand) {
    console.log(renderTopLevelHelp());
    return;
  }
  if (hasHelpFlag && isTopLevelHelpInvocation()) {
    console.log(renderTopLevelHelp());
    return;
  }

  // If no arguments or just help flags, check auth and show appropriate message
  if (args.length === 0) {
    const { isAuthenticated } = await import('./utils/auth');

    if (!isAuthenticated()) {
      // Not authenticated - prompt for login (banner is shown by ensureAuthenticated)
      await ensureAuthenticated();

      console.log('');
      console.log(
        `  ${fmt.success(`${icons.success} You're all set. Try scraping a URL:`)}`
      );
      console.log(`  ${fmt.dim('axon https://example.com')}`);
      console.log(
        `  ${fmt.dim(`${icons.arrow} For more commands, run: axon --help`)}`
      );
      console.log('');
      return;
    }

    // Authenticated - show banner and help
    printBanner();
    console.log(renderTopLevelHelp());
    return;
  }

  // Check if first argument is a URL (and not a command)
  if (!args[0].startsWith('-') && isUrl(args[0])) {
    // Treat as scrape command with URL - reuse commander's parsing
    const url = normalizeUrl(args[0]);

    // Collect any positional format arguments (non-flag arguments after the URL)
    const remainingArgs = args.slice(1);
    const positionalFormats: string[] = [];
    const otherArgs: string[] = [];

    for (const arg of remainingArgs) {
      // If it starts with a dash, it's a flag (and everything after goes to otherArgs)
      if (arg.startsWith('-')) {
        otherArgs.push(arg);
      } else if (otherArgs.length === 0) {
        // Only treat as positional format if we haven't hit a flag yet
        positionalFormats.push(arg);
      } else {
        // This is an argument to a flag
        otherArgs.push(arg);
      }
    }

    // Modify argv to include scrape command with URL and formats as positional arguments
    // This allows commander to parse it normally with all hooks and options
    const modifiedArgv = [
      process.argv[0],
      process.argv[1],
      'scrape',
      url,
      ...positionalFormats,
      ...otherArgs,
    ];

    // Parse using the main program (which includes hooks and global options)
    await program.parseAsync(modifiedArgv);
  } else {
    // Normal command parsing
    await program.parseAsync();
  }
}

main().catch((error) => {
  console.error(
    fmt.error(error instanceof Error ? error.message : 'Unknown error')
  );
  process.exit(1);
});
