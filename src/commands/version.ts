/**
 * Version command implementation
 * Displays the CLI version and optionally auth status
 */

import packageJson from '../../package.json';
import { isAuthenticated } from '../utils/auth';
import { fmt, icons } from '../utils/theme';

export interface VersionOptions {
  authStatus?: boolean;
}

/**
 * Display version information
 */
export function handleVersionCommand(options: VersionOptions = {}): void {
  console.log(
    `${fmt.primary('firecrawl')} ${fmt.dim(`v${packageJson.version}`)}`
  );

  if (options.authStatus) {
    const authenticated = isAuthenticated();
    const statusIcon = authenticated ? icons.success : icons.pending;
    const statusColor = authenticated ? fmt.success : fmt.dim;
    console.log(
      `${statusColor(`${statusIcon} ${authenticated ? 'authenticated' : 'not authenticated'}`)}`
    );
  }
}

import { Command } from 'commander';

/**
 * Create and configure the version command
 */
export function createVersionCommand(): Command {
  const versionCmd = new Command('version')
    .description('Display version information')
    .option(
      '--auth-status',
      'Also show authentication status (default: false)',
      false
    )
    .action((options) => {
      handleVersionCommand({ authStatus: options.authStatus });
    });

  return versionCmd;
}
