/**
 * Types and interfaces for the extract command
 */
import type { CommandResult } from './common';

export interface ExtractOptions {
  /** URLs to extract data from */
  urls: string[];
  /** Extraction prompt describing what data to extract */
  prompt?: string;
  /** JSON schema for structured extraction */
  schema?: string;
  /** System prompt for extraction context */
  systemPrompt?: string;
  /** Allow following external links */
  allowExternalLinks?: boolean;
  /** Enable web search for additional context */
  enableWebSearch?: boolean;
  /** Include subdomains when extracting */
  includeSubdomains?: boolean;
  /** Include source URLs in result */
  showSources?: boolean;
  /** API key for Firecrawl */
  apiKey?: string;
  /** Output file path */
  output?: string;
  /** Force JSON output */
  json?: boolean;
  /** Pretty print JSON output */
  pretty?: boolean;
  /** Enable auto-embedding of extracted content */
  embed?: boolean;
}

export type ExtractResult = CommandResult<{
  extracted: unknown;
  status?: 'processing' | 'completed' | 'failed' | 'cancelled';
  expiresAt?: string;
  tokensUsed?: number;
  sources?: string[] | Record<string, unknown>;
  warning?: string;
}>;
