/**
 * Embed command types
 */
import type { CommandResult } from './common';

export interface EmbedOptions {
  input: string; // URL, file path, or '-' for stdin
  url?: string; // explicit URL for metadata (required for file/stdin)
  collection?: string;
  noChunk?: boolean;
  apiKey?: string;
  output?: string;
  json?: boolean;
}

export type EmbedResult = CommandResult<{
  url: string;
  chunksEmbedded: number;
  collection: string;
}>;
