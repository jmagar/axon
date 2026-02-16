/**
 * Embed command types
 */
import type { CommandResult } from './common';

export interface EmbedOptions {
  input: string; // URL, file path, directory path, or '-' for stdin
  url?: string; // explicit source ID override for metadata
  stdinContent?: string; // pre-read stdin content (internal command plumbing)
  ingestId?: string; // internal: shared ingest batch ID for multi-file runs
  ingestRoot?: string; // internal: root directory for multi-file ingest metadata
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
  filesEmbedded?: number;
}>;
