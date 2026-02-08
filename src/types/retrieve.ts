/**
 * Types for the retrieve command
 * Reconstructs full documents from Qdrant chunks
 */
import type { CommandResult } from './common';

export interface RetrieveOptions {
  url: string;
  collection?: string;
  output?: string;
  json?: boolean;
}

export type RetrieveResult = CommandResult<{
  url: string;
  totalChunks: number;
  content: string;
  chunks?: Array<{
    index: number;
    header: string | null;
    text: string;
  }>;
}>;
