export interface BatchOptions {
  urls?: string[];
  jobId?: string;
  wait?: boolean;
  status?: boolean;
  errors?: boolean;
  cancel?: boolean;
  pollInterval?: number;
  timeout?: number;
  // scrape options
  format?: string;
  onlyMainContent?: boolean;
  waitFor?: number;
  scrapeTimeout?: number;
  screenshot?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  // batch options
  maxConcurrency?: number;
  ignoreInvalidUrls?: boolean;
  webhook?: string;
  zeroDataRetention?: boolean;
  idempotencyKey?: string;
  appendToId?: string;
  integration?: string;
  // output
  output?: string;
  pretty?: boolean;
  json?: boolean;
  apiKey?: string;
}

export interface BatchCancelData {
  success: true;
  message: string;
}

export interface BatchErrorsData {
  errors: Array<{
    id: string;
    url: string;
    error: string;
    timestamp?: string;
    code?: string;
  }>;
  robotsBlocked: string[];
}
