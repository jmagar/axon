#!/usr/bin/env node

/**
 * Firecrawl CLI
 * Entry point for the CLI application
 */

import { resolve } from 'node:path';
import { Command } from 'commander';
import { config as loadDotenv } from 'dotenv';

// Load .env from the CLI project directory, not the current working directory
// __dirname is available in CommonJS (tsconfig uses "module": "commonjs")
const envPath = resolve(__dirname, '..', '.env');
loadDotenv({ path: envPath });

import packageJson from '../package.json';
import { createBatchCommand } from './commands/batch';
import {
  createConfigCommand,
  createViewConfigCommand,
} from './commands/config';
import { createCrawlCommand } from './commands/crawl';
import { createEmbedCommand } from './commands/embed';
import { createExtractCommand } from './commands/extract';
import { createListCommand } from './commands/list';
import { createLoginCommand } from './commands/login';
import { createLogoutCommand } from './commands/logout';
import { createMapCommand } from './commands/map';
import { createQueryCommand } from './commands/query';
import { createRetrieveCommand } from './commands/retrieve';
import { createScrapeCommand } from './commands/scrape';
import { createSearchCommand } from './commands/search';
import { createStatusCommand, handleStatusCommand } from './commands/status';
import { createVersionCommand } from './commands/version';

import { ensureAuthenticated, printBanner } from './utils/auth';
import { initializeConfig, updateConfig } from './utils/config';
import { isUrl, normalizeUrl } from './utils/url';

// Initialize global configuration from environment variables
initializeConfig();

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
    console.error('\nForce exiting...');
    process.exit(130);
  }

  isShuttingDown = true;
  console.error(`\n${signal} received. Shutting down gracefully...`);

  // Give ongoing operations a moment to complete, then exit
  setTimeout(() => {
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }, 100);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Commands that require authentication
const AUTH_REQUIRED_COMMANDS = [
  'scrape',
  'crawl',
  'map',
  'search',
  'extract',
  'batch',
];

const program = new Command();

program
  .name('firecrawl')
  .description('CLI tool for Firecrawl web scraping')
  .version(packageJson.version)
  .option(
    '-k, --api-key <key>',
    'Firecrawl API key (or set FIRECRAWL_API_KEY env var)'
  )
  .option('--status', 'Show version, auth status, concurrency, and credits')
  .allowUnknownOption() // Allow unknown options when URL is passed directly
  .hook('preAction', async (thisCommand, actionCommand) => {
    // Update global config if API key is provided via global option
    const globalOptions = thisCommand.opts();
    if (globalOptions.apiKey) {
      updateConfig({ apiKey: globalOptions.apiKey });
    }

    // Check if this command requires authentication
    const commandName = actionCommand.name();
    if (AUTH_REQUIRED_COMMANDS.includes(commandName)) {
      // Ensure user is authenticated (prompts for login if needed)
      await ensureAuthenticated();
    }
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

// Add extract, embed, query, and retrieve commands to main program
program.addCommand(createExtractCommand());
program.addCommand(createEmbedCommand());
program.addCommand(createQueryCommand());
program.addCommand(createRetrieveCommand());
program.addCommand(createBatchCommand());

program.addCommand(createConfigCommand());

program.addCommand(createViewConfigCommand());

program.addCommand(createLoginCommand());

program.addCommand(createLogoutCommand());

program.addCommand(createVersionCommand());

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
    console.log(`version: ${packageJson.version}`);
    console.log(`authenticated: ${isAuthenticated()}`);
    return;
  }

  // Handle --status flag
  if (args.includes('--status')) {
    await handleStatusCommand();
    return;
  }

  // If no arguments or just help flags, check auth and show appropriate message
  if (args.length === 0) {
    const { isAuthenticated } = await import('./utils/auth');

    if (!isAuthenticated()) {
      // Not authenticated - prompt for login (banner is shown by ensureAuthenticated)
      await ensureAuthenticated();

      console.log("You're all set! Try scraping a URL:\n");
      console.log('  firecrawl https://example.com\n');
      console.log('For more commands, run: firecrawl --help\n');
      return;
    }

    // Authenticated - show banner and help
    printBanner();
    program.outputHelp();
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
    'Error:',
    error instanceof Error ? error.message : 'Unknown error'
  );
  process.exit(1);
});
