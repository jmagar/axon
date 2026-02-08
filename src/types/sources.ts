/**
 * Sources command types
 */
import type { CommandResult } from './common';

export interface SourceInfo {
  url: string;
  domain: string;
  title: string;
  totalChunks: number;
  sourceCommand: string;
  scrapedAt: string;
}

export interface SourcesOptions {
  domain?: string;
  source?: string;
  limit?: number;
  collection?: string;
  output?: string;
  json?: boolean;
}

export type SourcesResult = CommandResult<{
  sources: SourceInfo[];
  totalSources: number;
  totalChunks: number;
  uniqueDomains: number;
}>;
