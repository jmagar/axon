/**
 * API Key Scrubbing Utility
 *
 * Prevents credential leakage in logs, errors, and outputs by masking API keys.
 * Supports multiple key formats and contexts (error messages, URLs, headers, etc.).
 */

/**
 * Mask an API key for safe display
 *
 * @param key The API key to mask
 * @returns Masked key showing prefix and suffix with middle hidden
 */
export function maskApiKey(key: string): string {
  if (!key || typeof key !== 'string') {
    return 'INVALID_KEY';
  }

  // For very short keys (< 8 chars), fully mask
  if (key.length < 8) {
    return '*'.repeat(key.length);
  }

  // For short keys (8-15 chars), show minimal info
  if (key.length < 16) {
    return '*'.repeat(Math.min(key.length, 8));
  }

  // For normal keys (16+ chars), show prefix and suffix
  return `${key.substring(0, 6)}...${key.slice(-4)}`;
}

/**
 * Scrub API keys from a string (log message, error message, etc.)
 *
 * @param text The text to scrub
 * @param replacement Optional custom replacement (default: [REDACTED])
 * @returns Scrubbed text with API keys replaced
 */
export function scrubApiKeys(
  text: string,
  replacement: string = '[REDACTED]'
): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let scrubbed = text;

  // Patterns with capture groups (key=value style)
  const captureGroupPatterns = [
    /(?:api[_-]?key|apikey|key)=([a-zA-Z0-9_-]{16,})/gi,
    /Bearer\s+([a-zA-Z0-9_\-.]{20,})/gi,
    /Authorization:\s*([a-zA-Z0-9_\-.]{20,})/gi,
  ];

  // Patterns without capture groups (full replacement)
  const fullReplacementPatterns = [
    /fc-[a-zA-Z0-9]{20,}/g,
    /\b[a-zA-Z0-9_-]{40,}\b/g,
  ];

  // Apply full replacement patterns first
  for (const pattern of fullReplacementPatterns) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }

  // Apply capture group patterns (preserve prefix)
  for (const pattern of captureGroupPatterns) {
    scrubbed = scrubbed.replace(pattern, (match, group1) => {
      return match.replace(group1, replacement);
    });
  }

  return scrubbed;
}

/**
 * Scrub API keys from an Error object
 *
 * Creates a new Error with scrubbed message and stack trace.
 * Original error is not modified.
 *
 * @param error The error to scrub
 * @returns New error with scrubbed message and stack
 */
export function scrubErrorApiKeys(error: Error): Error {
  const scrubbed = new Error(scrubApiKeys(error.message));
  scrubbed.name = error.name;

  if (error.stack) {
    scrubbed.stack = scrubApiKeys(error.stack);
  }

  // Preserve other error properties
  if (error.cause) {
    if (error.cause instanceof Error) {
      scrubbed.cause = scrubErrorApiKeys(error.cause);
    } else if (typeof error.cause === 'string') {
      scrubbed.cause = scrubApiKeys(error.cause);
    } else if (typeof error.cause === 'object' && error.cause !== null) {
      scrubbed.cause = scrubObjectApiKeys(error.cause);
    } else {
      scrubbed.cause = error.cause;
    }
  }

  return scrubbed;
}

/**
 * Scrub API keys from URLs (query parameters, path segments)
 *
 * @param url The URL to scrub
 * @returns Scrubbed URL with API keys replaced
 */
export function scrubUrlApiKeys(url: string): string {
  if (!url || typeof url !== 'string') {
    return url;
  }

  try {
    const parsed = new URL(url);

    // Scrub query parameters manually to avoid URL encoding issues
    if (parsed.search) {
      let scrubbedSearch = parsed.search;

      // Scrub entire values for sensitive parameters
      scrubbedSearch = scrubbedSearch.replace(
        /(api[_-]?key|apikey|key|token|auth)=([^&]*)/gi,
        '$1=REDACTED'
      );

      // Scrub any remaining API keys in other parameters
      scrubbedSearch = scrubApiKeys(scrubbedSearch, 'REDACTED');

      parsed.search = scrubbedSearch;
    }

    // Scrub path segments
    parsed.pathname = scrubApiKeys(parsed.pathname, 'REDACTED');

    // Scrub hash
    if (parsed.hash) {
      parsed.hash = scrubApiKeys(parsed.hash, 'REDACTED');
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, fall back to string scrubbing
    return scrubApiKeys(url, 'REDACTED');
  }
}

/**
 * Sanitize URL credentials (username/password)
 *
 * Redacts passwords in URLs while preserving username in format: username:***
 * This prevents credential leakage in logs and outputs.
 *
 * @param url The URL to sanitize
 * @returns Sanitized URL with password redacted
 *
 * @example
 * sanitizeUrlCredentials('redis://user:secret@localhost:6379')
 * // Returns: 'redis://user:***@localhost:6379'
 */
export function sanitizeUrlCredentials(url: string): string {
  if (!url || typeof url !== 'string') {
    return url;
  }

  try {
    const parsed = new URL(url);

    // If URL has password, redact it while keeping username
    if (parsed.password) {
      parsed.password = '***';
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, use regex fallback
    // Matches protocol://username:password@host pattern
    return url.replace(
      /(:\/\/)([^:@]+):([^@]+)@/,
      (_match, protocol, username, _password) => {
        return `${protocol}${username}:***@`;
      }
    );
  }
}

/**
 * Scrub API keys from HTTP headers
 *
 * @param headers Headers object or Record
 * @returns New headers object with API keys scrubbed
 */
export function scrubHeaderApiKeys(
  headers: Record<string, string | string[]>
): Record<string, string | string[]> {
  const scrubbed: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    // Scrub sensitive header values entirely (use word boundaries to avoid false positives)
    if (/\b(authorization|api[_-]?key|apikey|token)\b/i.test(key)) {
      scrubbed[key] = Array.isArray(value)
        ? value.map(() => '[REDACTED]')
        : '[REDACTED]';
    } else {
      // For other headers, scrub any keys in the value
      scrubbed[key] = Array.isArray(value)
        ? value.map((v) => scrubApiKeys(v))
        : scrubApiKeys(value);
    }
  }

  return scrubbed;
}

/**
 * Scrub API keys from an object (deep)
 *
 * Recursively scrubs API keys from object properties and values.
 *
 * @param obj The object to scrub
 * @param maxDepth Maximum recursion depth (default: 10)
 * @returns New object with API keys scrubbed
 */
export function scrubObjectApiKeys<T>(obj: T, maxDepth: number = 10): T {
  if (maxDepth <= 0) {
    return obj;
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return scrubApiKeys(obj) as T;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubObjectApiKeys(item, maxDepth - 1)) as T;
  }

  const scrubbed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Scrub sensitive keys entirely (use word boundaries to avoid false positives)
    if (
      /\b(api[_-]?key|apikey|password|secret|token|authorization)\b/i.test(key)
    ) {
      scrubbed[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      scrubbed[key] = scrubApiKeys(value);
    } else if (typeof value === 'object' && value !== null) {
      scrubbed[key] = scrubObjectApiKeys(value, maxDepth - 1);
    } else {
      scrubbed[key] = value;
    }
  }

  return scrubbed as T;
}
