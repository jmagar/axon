/**
 * Query command types
 */
import type { CommandResult } from './common';

export interface QueryOptions {
  query: string;
  limit?: number;
  domain?: string;
  full?: boolean;
  group?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
}

export interface QueryResultItem {
  score: number;
  url: string;
  title: string;
  chunkHeader: string | null;
  chunkText: string;
  chunkIndex: number;
  totalChunks: number;
  domain: string;
  sourceCommand: string;
}

export type QueryResult = CommandResult<QueryResultItem[]>;
