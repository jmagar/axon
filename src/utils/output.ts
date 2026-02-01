/**
 * Output utilities for CLI
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Validates that an output path is safe (within cwd or a configured base directory).
 * Prevents path traversal attacks including symlink-based escapes.
 *
 * Uses fs.realpathSync() to follow all symlinks and validate the actual
 * filesystem location, preventing attackers from using symlinks to escape
 * the allowed directory.
 *
 * @param outputPath - The user-provided output path
 * @param baseDir - The safe base directory (defaults to process.cwd())
 * @returns The resolved absolute path if valid
 * @throws Error if the path escapes the safe directory
 */
export function validateOutputPath(
  outputPath: string,
  baseDir: string = process.cwd()
): string {
  // Get real filesystem path for base directory (following symlinks)
  const realBase = fs.realpathSync(baseDir);
  const resolvedPath = path.resolve(realBase, outputPath);

  // Resolve symlinks to get actual filesystem location
  let realPath: string;
  try {
    if (fs.existsSync(resolvedPath)) {
      // Path exists - resolve it (follows symlinks)
      realPath = fs.realpathSync(resolvedPath);
    } else {
      // Path doesn't exist - validate parent directory
      const parentDir = path.dirname(resolvedPath);
      const fileName = path.basename(resolvedPath);

      if (fs.existsSync(parentDir)) {
        const realParent = fs.realpathSync(parentDir);
        realPath = path.join(realParent, fileName);
      } else {
        // Parent doesn't exist - use logical resolution
        realPath = resolvedPath;
      }
    }
  } catch (error) {
    throw new Error(
      `Cannot validate output path "${outputPath}": ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }

  // Check if real path is within base directory
  if (!realPath.startsWith(realBase + path.sep) && realPath !== realBase) {
    throw new Error(
      `Invalid output path: "${outputPath}" resolves outside allowed directory ` +
        `(${realPath} is not under ${realBase}). Path traversal not allowed.`
    );
  }

  return realPath;
}

import type { Document } from '@mendable/firecrawl-js';
import type { ScrapeFormat, ScrapeResult } from '../types/scrape';

/**
 * Determine if output should be JSON based on flag or file extension
 */
function shouldOutputJson(outputPath?: string, jsonFlag?: boolean): boolean {
  // Explicit --json flag takes precedence
  if (jsonFlag) return true;

  // Infer from .json extension
  if (outputPath?.toLowerCase().endsWith('.json')) {
    return true;
  }

  return false;
}

/**
 * Text formats that can be output as raw content (curl-like)
 */
const RAW_TEXT_FORMATS: ScrapeFormat[] = [
  'html',
  'rawHtml',
  'markdown',
  'links',
  'images',
  'summary',
];

/**
 * Format screenshot output nicely
 */
function formatScreenshotOutput(data: Document): string {
  const lines: string[] = [];

  // Screenshot URL
  if (data.screenshot) {
    lines.push(`Screenshot: ${data.screenshot}`);
  }

  // Page info from metadata
  if (data.metadata) {
    if (data.metadata.title) {
      lines.push(`Title: ${data.metadata.title}`);
    }
    if (data.metadata.sourceURL || data.metadata.url) {
      lines.push(`URL: ${data.metadata.sourceURL || data.metadata.url}`);
    }
    if (data.metadata.description) {
      lines.push(`Description: ${data.metadata.description}`);
    }
  }

  return lines.join('\n');
}

/**
 * Extract content from Firecrawl Document based on format
 */
function extractContent(data: Document, format: ScrapeFormat): string | null {
  if (!data) return null;

  // Handle html/rawHtml formats - extract HTML content directly
  if (format === 'html' || format === 'rawHtml') {
    return data.html || data.rawHtml || data[format] || null;
  }

  // Handle markdown format
  if (format === 'markdown') {
    return data.markdown || data[format] || null;
  }

  // Handle links format (array of URLs -> newline-separated string)
  if (format === 'links') {
    const links = data.links || data[format];
    if (Array.isArray(links)) {
      return links.join('\n');
    }
    return links || null;
  }

  // Handle images format (array of URLs -> newline-separated string)
  if (format === 'images') {
    const images = data.images || data[format];
    if (Array.isArray(images)) {
      return images.join('\n');
    }
    return images || null;
  }

  // Handle summary format
  if (format === 'summary') {
    return data.summary || data[format] || null;
  }

  return null;
}

/**
 * Extract multiple format contents from response data
 */
function extractMultipleFormats(
  data: Document,
  formats: ScrapeFormat[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const format of formats) {
    const key = format;

    if (data[key] !== undefined) {
      result[key] = data[key];
    } else if (format === 'html' && data.rawHtml !== undefined) {
      // Fallback for html -> rawHtml
      result[key] = data.rawHtml;
    } else if (format === 'rawHtml' && data.html !== undefined) {
      // Fallback for rawHtml -> html
      result[key] = data.html;
    }
  }

  // Always include metadata if present
  if (data.metadata) {
    result.metadata = data.metadata;
  }

  return result;
}

/**
 * Write output to file or stdout
 */
export function writeOutput(
  content: string,
  outputPath?: string,
  silent: boolean = false
): void {
  if (outputPath) {
    // Validate path to prevent traversal attacks
    const safePath = validateOutputPath(outputPath);
    const dir = path.dirname(safePath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(safePath, content, 'utf-8');
    if (!silent) {
      // Always use stderr for file confirmation messages
      console.error(`Output written to: ${safePath}`);
    }
  } else {
    // Use process.stdout.write for raw output (like curl)
    // Ensure content ends with newline for proper piping
    if (!content.endsWith('\n')) {
      content += '\n';
    }
    process.stdout.write(content);
  }
}

/**
 * Handle scrape result output
 *
 * Output behavior:
 * - If --json flag or .json output file: always JSON output
 * - Single text format (html, markdown, links, images, summary, rawHtml): raw content
 * - Single complex format (screenshot, json, branding, etc.): JSON output
 * - Multiple formats: JSON with all requested data
 */
export function handleScrapeOutput(
  result: ScrapeResult,
  formats: ScrapeFormat[],
  outputPath?: string,
  pretty: boolean = false,
  json: boolean = false
): void {
  if (!result.success) {
    // Always use stderr for errors to allow piping
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (!result.data) {
    return;
  }

  // Determine if we should force JSON output
  const forceJson = shouldOutputJson(outputPath, json);

  // If JSON is forced, always output JSON regardless of format
  if (forceJson) {
    let jsonContent: string;
    try {
      jsonContent = pretty
        ? JSON.stringify(result.data, null, 2)
        : JSON.stringify(result.data);
    } catch (error) {
      jsonContent = JSON.stringify({
        error: 'Failed to serialize response',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    writeOutput(jsonContent, outputPath, !!outputPath);
    return;
  }

  // Determine output mode based on number of formats
  const isSingleFormat = formats.length === 1;
  const singleFormat = isSingleFormat ? formats[0] : null;
  const isRawTextFormat =
    singleFormat && RAW_TEXT_FORMATS.includes(singleFormat);

  // Single raw text format: output raw content (current behavior)
  if (isSingleFormat && isRawTextFormat && singleFormat) {
    const content = extractContent(result.data, singleFormat);
    if (content !== null) {
      writeOutput(content, outputPath, !!outputPath);
      return;
    }
  }

  // Single screenshot format: output nicely formatted
  if (
    isSingleFormat &&
    singleFormat === 'screenshot' &&
    result.data.screenshot
  ) {
    const content = formatScreenshotOutput(result.data);
    writeOutput(content, outputPath, !!outputPath);
    return;
  }

  // Multiple formats or complex format: output JSON
  let outputData: Document | Record<string, unknown>;

  if (isSingleFormat) {
    // Single complex format - output entire data object
    outputData = result.data;
  } else {
    // Multiple formats - extract only requested formats
    outputData = extractMultipleFormats(result.data, formats);
  }

  let jsonContent: string;
  try {
    jsonContent = pretty
      ? JSON.stringify(outputData, null, 2)
      : JSON.stringify(outputData);
  } catch (error) {
    jsonContent = JSON.stringify({
      error: 'Failed to serialize response',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  writeOutput(jsonContent, outputPath, !!outputPath);
}
