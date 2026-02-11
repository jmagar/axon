/**
 * Network-aware error formatting helpers for CLI commands.
 */

const NETWORK_ERROR_INDICATORS = [
  'fetch failed',
  'network error',
  'econnrefused',
  'econnreset',
  'etimedout',
  'enotfound',
  'eai_again',
  'socket hang up',
  'socket timeout',
  'epipe',
];

function isLocalApiUrl(apiUrl: string | undefined): boolean {
  if (!apiUrl) {
    return false;
  }

  try {
    const parsed = new URL(apiUrl);
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(
      parsed.hostname
    );
  } catch {
    return false;
  }
}

function isLikelyNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  const code = (error as Error & { code?: string }).code?.toLowerCase();

  return NETWORK_ERROR_INDICATORS.some(
    (indicator) =>
      message.includes(indicator) ||
      name.includes(indicator) ||
      code?.includes(indicator)
  );
}

/**
 * Build command error text with an actionable self-hosted connectivity hint.
 */
export function buildApiErrorMessage(
  error: unknown,
  apiUrl: string | undefined
): string {
  if (!(error instanceof Error)) {
    return 'Unknown error occurred';
  }

  if (isLocalApiUrl(apiUrl) && isLikelyNetworkError(error)) {
    return `${error.message}\nCould not reach Firecrawl API at ${apiUrl}. Verify the self-hosted service is running and reachable.`;
  }

  return error.message;
}
