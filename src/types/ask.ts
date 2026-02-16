/**
 * Ask command types
 */
import type { CommandResult } from './common';

/**
 * Options for ask command
 */
export interface AskOptions {
  query: string;
  limit?: number;
  fullDocs?: number;
  backfillChunks?: number;
  domain?: string;
  collection?: string;
  model?: string;
  maxContext?: number;
  diagnostics?: boolean;
}

/**
 * Source information for ask results
 */
export interface AskSource {
  url: string;
  title?: string;
  score: number;
}

/**
 * Ask command result data
 */
export interface AskResultData {
  query: string;
  context: string;
  answer: string;
  sources: AskSource[];
  appliedScope?: string;
  scopeFallback?: boolean;
  scopeStrict?: boolean;
  fullDocumentsUsed: number;
  chunksUsed: number;
  rawCandidateChunks: number;
  scopedCandidateChunks: number;
  uniqueSourceUrls: number;
  candidateChunks: number;
  contextCharsUsed: number;
  contextCharsLimit: number;
  responseDurationSeconds: number;
}

/**
 * Ask command result
 */
export type AskResult = CommandResult<AskResultData>;
