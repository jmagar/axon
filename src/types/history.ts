/**
 * History command types
 * Represents time-based view of indexed content
 */

export interface HistoryEntry {
  date: string;
  url: string;
  domain: string;
  sourceCommand: string;
  chunks: number;
}

export interface HistoryOptions {
  days?: number;
  domain?: string;
  source?: string;
  limit?: number;
  collection?: string;
  output?: string;
  json?: boolean;
}

export interface HistoryResult {
  success: boolean;
  data?: {
    entries: HistoryEntry[];
    totalEntries: number;
    dateRange: { from: string; to: string };
  };
  error?: string;
}
