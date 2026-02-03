/**
 * Info command types
 */

export interface UrlInfo {
  url: string;
  domain: string;
  title: string;
  totalChunks: number;
  sourceCommand: string;
  contentType: string;
  scrapedAt: string;
  chunks: Array<{
    index: number;
    header: string | null;
    textPreview: string;
  }>;
}

export interface InfoOptions {
  url: string;
  full?: boolean;
  collection?: string;
  output?: string;
  json?: boolean;
}

export interface InfoResult {
  success: boolean;
  data?: UrlInfo;
  error?: string;
}
