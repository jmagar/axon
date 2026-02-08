/**
 * Shared command utilities for consistent error handling, output formatting,
 * and result processing across all CLI commands.
 *
 * This module eliminates code duplication by providing:
 * - Unified result type for command execution
 * - Consistent error handling with proper exit codes
 * - JSON formatting with pretty-print support
 * - Output handling for both file and stdout
 *
 * @module utils/command
 */

import { validateOutputPath, writeOutput } from './output';
import { fmt } from './theme';

/**
 * Standard result type for all command executions.
 * All execute* functions should return this type.
 */
export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Common options shared across multiple commands
 */
export interface CommonOutputOptions {
  /** Output file path (if undefined, output goes to stdout) */
  output?: string;
  /** Pretty-print JSON output */
  pretty?: boolean;
  /** Force JSON output format */
  json?: boolean;
}

/**
 * Handle command result: check for errors and exit if failed.
 *
 * This consolidates the repeated pattern:
 * ```
 * if (!result.success) {
 *   console.error('Error:', result.error);
 *   process.exit(1);
 * }
 * ```
 *
 * @param result - The command execution result
 * @param exitOnError - Whether to call process.exit(1) on error (default: true)
 * @returns true if successful, false if error (only when exitOnError=false)
 */
export function handleCommandError<T>(
  result: CommandResult<T>,
  exitOnError: boolean = true
): result is CommandResult<T> & { success: true; data: T } {
  if (!result.success) {
    console.error(fmt.error(result.error || 'Unknown error occurred'));
    if (exitOnError) {
      process.exit(1);
    }
    return false;
  }
  return true;
}

/**
 * Format data as JSON string with optional pretty-printing.
 *
 * Consolidates the repeated pattern:
 * ```
 * options.pretty
 *   ? JSON.stringify(data, null, 2)
 *   : JSON.stringify(data)
 * ```
 *
 * @param data - The data to format as JSON
 * @param pretty - Whether to pretty-print with indentation
 * @returns JSON string
 */
export function formatJson(data: unknown, pretty: boolean = false): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

/**
 * Wrap data in a standard success response format.
 *
 * @param data - The data to wrap
 * @returns Object with success: true and the data
 */
export function wrapSuccessResponse<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

/**
 * Write command output to file or stdout.
 *
 * This combines JSON formatting and output handling in one call,
 * eliminating the need for separate format + write calls.
 *
 * @param content - The content to output (will be JSON stringified if not a string)
 * @param options - Output options (output path, pretty, json flag)
 * @param forceJson - Force JSON output even for string content
 */
export function writeCommandOutput(
  content: unknown,
  options: CommonOutputOptions,
  forceJson: boolean = false
): void {
  if (options.output) {
    validateOutputPath(options.output);
  }

  let outputContent: string;

  if (typeof content === 'string' && !forceJson) {
    outputContent = content;
  } else {
    outputContent = formatJson(content, options.pretty);
  }

  writeOutput(outputContent, options.output, !!options.output);
}

/**
 * Write JSON output with standard success wrapper.
 *
 * Outputs: { "success": true, "data": <data> }
 *
 * @param data - The data to output
 * @param options - Output options
 */
export function writeJsonOutput<T>(
  data: T,
  options: CommonOutputOptions
): void {
  writeCommandOutput(wrapSuccessResponse(data), options, true);
}

/**
 * Determine if output should be JSON based on options or file extension.
 *
 * @param options - Output options
 * @returns true if output should be JSON
 */
export function shouldOutputJson(options: CommonOutputOptions): boolean {
  // Explicit --json flag takes precedence
  if (options.json) return true;

  // Infer from .json extension
  if (options.output?.toLowerCase().endsWith('.json')) {
    return true;
  }

  return false;
}

/**
 * Process a command result and write output.
 *
 * This is the most common pattern across commands:
 * 1. Check for errors and exit if failed
 * 2. Format the data (JSON or custom formatter)
 * 3. Write to file or stdout
 *
 * @param result - The command execution result
 * @param options - Output options
 * @param formatter - Optional custom formatter for non-JSON output
 * @returns The result data if successful, undefined if error
 */
export function processCommandResult<T>(
  result: CommandResult<T>,
  options: CommonOutputOptions,
  formatter?: (data: T) => string
): T | undefined {
  if (!handleCommandError(result)) {
    return undefined;
  }

  if (!result.data) {
    return undefined;
  }

  const useJson = shouldOutputJson(options) || !formatter;

  if (useJson) {
    writeJsonOutput(result.data, options);
  } else {
    const content = formatter(result.data);
    writeCommandOutput(content, options);
  }

  return result.data;
}
