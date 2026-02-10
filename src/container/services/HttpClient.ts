/**
 * HTTP Client Service
 * Provides HTTP utilities with timeout and retry support
 *
 * Delegates to centralized utilities in utils/http.ts
 * This service provides a DI-container compatible interface
 */

import {
  fetchWithRetry as utilFetchWithRetry,
  fetchWithTimeout as utilFetchWithTimeout,
} from '../../utils/http';
import type { IHttpClient } from '../types';

/**
 * HttpClient service implementation
 * Delegates to centralized HTTP utilities
 */
export class HttpClient implements IHttpClient {
  /**
   * Fetch with automatic retry on transient errors
   *
   * Delegates to utils/http.ts fetchWithRetry with options mapping
   *
   * @param url URL to fetch
   * @param init Fetch init options
   * @param options Retry options
   * @returns Fetch Response
   * @throws Error if all retries are exhausted or non-retryable error occurs
   */
  async fetchWithRetry(
    url: string,
    init?: RequestInit,
    options?: {
      timeoutMs?: number;
      maxRetries?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
    }
  ): Promise<Response> {
    const retryOptions =
      options === undefined
        ? undefined
        : {
            ...(options.timeoutMs !== undefined
              ? { timeoutMs: options.timeoutMs }
              : {}),
            ...(options.maxRetries !== undefined
              ? { maxRetries: options.maxRetries }
              : {}),
            ...(options.baseDelayMs !== undefined
              ? { baseDelayMs: options.baseDelayMs }
              : {}),
            ...(options.maxDelayMs !== undefined
              ? { maxDelayMs: options.maxDelayMs }
              : {}),
          };

    return utilFetchWithRetry(url, init, retryOptions);
  }

  /**
   * Fetch with timeout but no retry
   *
   * Delegates to utils/http.ts fetchWithTimeout
   *
   * @param url URL to fetch
   * @param init Fetch init options
   * @param timeoutMs Request timeout in milliseconds
   * @returns Fetch Response
   * @throws Error if timeout or network error occurs
   */
  async fetchWithTimeout(
    url: string,
    init?: RequestInit,
    timeoutMs?: number
  ): Promise<Response> {
    return utilFetchWithTimeout(url, init, timeoutMs);
  }
}
