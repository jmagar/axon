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
  domain?: string;
  collection?: string;
  model?: string;
  maxContext?: number;
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
  documentsRetrieved: number;
}

/**
 * Ask command result
 */
export type AskResult = CommandResult<AskResultData>;
