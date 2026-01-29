/**
 * Status command implementation
 * Displays CLI version, auth status, and API URL
 */

import packageJson from '../../package.json';
import { isAuthenticated } from '../utils/auth';
import { DEFAULT_API_URL, getConfig } from '../utils/config';
import { loadCredentials } from '../utils/credentials';

type AuthSource = 'env' | 'stored' | 'none';

interface StatusResult {
  version: string;
  authenticated: boolean;
  authSource: AuthSource;
  apiUrl: string;
}

/**
 * Detect how the user is authenticated
 */
function getAuthSource(): AuthSource {
  if (process.env.FIRECRAWL_API_KEY) {
    return 'env';
  }
  const stored = loadCredentials();
  if (stored?.apiKey) {
    return 'stored';
  }
  return 'none';
}

/**
 * Get status information
 */
export function getStatus(): StatusResult {
  const authSource = getAuthSource();
  const config = getConfig();

  return {
    version: packageJson.version,
    authenticated: isAuthenticated(),
    authSource,
    apiUrl: config.apiUrl || DEFAULT_API_URL,
  };
}

/**
 * Handle status command output
 */
export async function handleStatusCommand(): Promise<void> {
  const orange = '\x1b[38;5;208m';
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const bold = '\x1b[1m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';

  const status = getStatus();

  // Header
  console.log('');
  console.log(
    `  ${orange}🔥 ${bold}firecrawl${reset} ${dim}cli${reset} ${dim}v${status.version}${reset}`
  );
  console.log('');

  // Auth status with source
  if (status.authenticated) {
    const sourceLabel =
      status.authSource === 'env'
        ? 'via FIRECRAWL_API_KEY'
        : 'via stored credentials';
    console.log(
      `  ${green}●${reset} Authenticated ${dim}${sourceLabel}${reset}`
    );
  } else {
    console.log(`  ${red}●${reset} Not authenticated`);
    console.log(`  ${dim}Run 'firecrawl login' to authenticate${reset}`);
    console.log('');
    return;
  }

  // API URL
  console.log(`  ${dim}API URL:${reset} ${status.apiUrl}`);
  console.log('');
}
