/**
 * HTTP Client Service
 * Provides HTTP utilities with timeout and retry support
 *
 * Delegates to centralized utilities in utils/http.ts
 * This service provides a DI-container compatible interface
 */

import type { EffectiveUserSettings } from '../../schemas/storage';
import {
  type HttpOptions,
  fetchWithRetry as utilFetchWithRetry,
  fetchWithTimeout as utilFetchWithTimeout,
} from '../../utils/http';
import type { IHttpClient } from '../types';

function omitUndefinedValues<T extends Record<string, unknown>>(
  input: T
): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

/**
 * HttpClient service implementation
 * Delegates to centralized HTTP utilities
 *
 * When settings are provided (via container), pre-computes default HTTP options
 * to avoid per-call getSettings() filesystem I/O (PERF-02/ARCH-07)
 */
export class HttpClient implements IHttpClient {
  private readonly defaultOptions: Required<HttpOptions> | undefined;

  constructor(settings?: EffectiveUserSettings) {
    if (settings) {
      this.defaultOptions = {
        timeoutMs: settings.http.timeoutMs,
        maxRetries: settings.http.maxRetries,
        baseDelayMs: settings.http.baseDelayMs,
        maxDelayMs: settings.http.maxDelayMs,
      };
    }
  }

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
    // Merge caller options over pre-computed defaults (avoids getSettings() I/O)
    const mergedOptions = this.defaultOptions
      ? { ...this.defaultOptions, ...omitUndefinedValues(options ?? {}) }
      : options === undefined
        ? undefined
        : (omitUndefinedValues(options) as typeof options);

    return utilFetchWithRetry(url, init, mergedOptions);
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
    const effectiveTimeout = timeoutMs ?? this.defaultOptions?.timeoutMs;
    return utilFetchWithTimeout(url, init, effectiveTimeout);
  }
}
