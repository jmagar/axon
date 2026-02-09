/**
 * Option parsing utilities
 */

import type { ScrapeFormat, ScrapeOptions } from '../types/scrape';

/**
 * Valid scrape format values
 */
const VALID_FORMATS: ScrapeFormat[] = [
  'markdown',
  'html',
  'rawHtml',
  'links',
  'images',
  'screenshot',
  'summary',
  'changeTracking',
  'json',
  'attributes',
  'branding',
];

/**
 * Map from lowercase to correct camelCase format
 */
const FORMAT_MAP: Record<string, ScrapeFormat> = Object.fromEntries(
  VALID_FORMATS.map((f) => [f.toLowerCase(), f])
) as Record<string, ScrapeFormat>;

/**
 * Parse format string into array of ScrapeFormat
 * Handles comma-separated values: "markdown,links,images"
 * Case-insensitive input, returns correct camelCase for API
 */
export function parseFormats(formatString: string): ScrapeFormat[] {
  const inputFormats = formatString
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f.length > 0);

  // Validate and map to correct casing
  const invalidFormats: string[] = [];
  const validFormats: ScrapeFormat[] = [];

  for (const input of inputFormats) {
    const mapped = FORMAT_MAP[input];
    if (mapped) {
      validFormats.push(mapped);
    } else {
      invalidFormats.push(input);
    }
  }

  if (invalidFormats.length > 0) {
    throw new Error(
      `Invalid format(s): ${invalidFormats.join(', ')}. Valid formats are: ${VALID_FORMATS.join(', ')}`
    );
  }

  // Remove duplicates while preserving order
  return [...new Set(validFormats)];
}

/**
 * Convert commander options to ScrapeOptions
 */
/**
 * Raw Commander.js options for scrape command before parsing
 */
export interface CommanderScrapeOptions {
  url: string;
  format?: string;
  onlyMainContent?: boolean;
  waitFor?: number;
  timeout?: number;
  screenshot?: boolean;
  includeTags?: string;
  excludeTags?: string;
  apiKey?: string;
  output?: string;
  pretty?: boolean;
  json?: boolean;
  timing?: boolean;
  embed?: boolean;
}

/**
 * Convert commander options to ScrapeOptions
 */
export function parseScrapeOptions(
  options: CommanderScrapeOptions
): ScrapeOptions {
  // Parse formats from comma-separated string
  let formats: ScrapeFormat[] | undefined;
  if (options.format) {
    formats = parseFormats(options.format);
  }

  return {
    url: options.url,
    formats,
    onlyMainContent: options.onlyMainContent,
    waitFor: options.waitFor,
    timeout: options.timeout,
    screenshot: options.screenshot,
    includeTags: options.includeTags
      ? options.includeTags.split(',').map((t: string) => t.trim())
      : undefined,
    excludeTags: options.excludeTags
      ? options.excludeTags.split(',').map((t: string) => t.trim())
      : undefined,
    apiKey: options.apiKey,
    output: options.output,
    pretty: options.pretty,
    json: options.json,
    timing: options.timing,
    embed: options.embed,
  };
}

/**
 * Raw Commander.js options for info command before parsing
 */
export interface CommanderInfoOptions {
  full?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
}

/**
 * Convert commander options to InfoOptions
 */
export function parseInfoOptions(
  url: string,
  options: CommanderInfoOptions
): {
  url: string;
  full?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
} {
  return {
    url,
    full: options.full,
    collection: options.collection,
    output: options.output,
    json: options.json,
  };
}

/**
 * Raw Commander.js options for delete command before parsing
 */
export interface CommanderDeleteOptions {
  url?: string;
  domain?: string;
  all?: boolean;
  yes?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
}

/**
 * Convert commander options to DeleteOptions
 */
export function parseDeleteOptions(options: CommanderDeleteOptions): {
  url?: string;
  domain?: string;
  all?: boolean;
  yes?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
} {
  return {
    url: options.url,
    domain: options.domain,
    all: options.all,
    yes: options.yes,
    collection: options.collection,
    output: options.output,
    json: options.json,
  };
}
