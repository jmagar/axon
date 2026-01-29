/**
 * HTTP utilities with timeout and retry support
 *
 * Provides a wrapper around fetch with:
 * - Configurable timeout using AbortController
 * - Exponential backoff retry for transient errors
 * - Consistent error handling
 *
 * @module utils/http
 */

/**
 * Configuration options for HTTP requests
 */
export interface HttpOptions {
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay between retries in ms (default: 30000) */
  maxDelayMs?: number;
}

/**
 * Default HTTP configuration
 */
const DEFAULT_HTTP_OPTIONS: Required<HttpOptions> = {
  timeoutMs: 30000,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * HTTP status codes that should trigger a retry
 */
const RETRYABLE_STATUS_CODES = [
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
];

/**
 * Error types that should trigger a retry
 */
const RETRYABLE_ERROR_TYPES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'AbortError',
];

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Check error name (AbortError for timeout)
    if (RETRYABLE_ERROR_TYPES.includes(error.name)) {
      return true;
    }
    // Check error code (Node.js system errors)
    const errorWithCode = error as Error & { code?: string };
    if (
      errorWithCode.code &&
      RETRYABLE_ERROR_TYPES.includes(errorWithCode.code)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate delay for exponential backoff with jitter
 */
function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  // Add jitter (±25% randomization)
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  const delay = exponentialDelay + jitter;
  // Cap at maximum delay
  return Math.min(delay, maxDelayMs);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make an HTTP request with timeout and retry support
 *
 * @param url - The URL to fetch
 * @param init - Fetch request options
 * @param options - HTTP configuration (timeout, retries)
 * @returns The fetch Response
 * @throws Error if all retries are exhausted or non-retryable error occurs
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: HttpOptions
): Promise<Response> {
  const config = { ...DEFAULT_HTTP_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check if we should retry based on status code
      if (
        RETRYABLE_STATUS_CODES.includes(response.status) &&
        attempt < config.maxRetries
      ) {
        lastError = new Error(
          `HTTP ${response.status}: ${response.statusText}`
        );
        const delay = calculateBackoff(
          attempt,
          config.baseDelayMs,
          config.maxDelayMs
        );
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      // Wrap AbortError with more context
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${config.timeoutMs}ms`);
        lastError.name = 'TimeoutError';
      } else if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error(String(error));
      }

      // Only retry if it's a retryable error and we have attempts left
      if (isRetryableError(error) && attempt < config.maxRetries) {
        const delay = calculateBackoff(
          attempt,
          config.baseDelayMs,
          config.maxDelayMs
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable error or out of retries
      throw lastError;
    }
  }

  // Should only reach here if all retries exhausted
  throw lastError || new Error('Request failed after all retries');
}

/**
 * Make an HTTP request with timeout (no retry)
 *
 * Useful for operations that should not be retried (e.g., POST with side effects)
 *
 * @param url - The URL to fetch
 * @param init - Fetch request options
 * @param timeoutMs - Request timeout in milliseconds (default: 30000)
 * @returns The fetch Response
 * @throws Error if timeout or network error occurs
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_HTTP_OPTIONS.timeoutMs
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error(`Request timeout after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  }
}
