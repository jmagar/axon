/**
 * Types and interfaces for the extract command
 */

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

export interface ExtractResult {
  success: boolean;
  data?: {
    extracted: unknown;
    sources?: string[];
    warning?: string;
  };
  error?: string;
}
