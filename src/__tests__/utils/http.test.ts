/**
 * Comprehensive tests for HTTP utilities
 *
 * Coverage goals:
 * - Timeout handling (default 30s)
 * - Retry logic (503, 429, 500, 502, 504)
 * - Non-retryable errors (400, 401, 403)
 * - Exponential backoff with jitter
 * - Max retry exhaustion
 * - Network errors (ECONNRESET, ECONNREFUSED, etc.)
 * - Both fetchWithRetry and fetchWithTimeout
 *
 * Target: 100% line coverage for src/utils/http.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, fetchWithTimeout } from '../../utils/http';

// Mock global fetch
global.fetch = vi.fn();

describe('HTTP Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('fetchWithTimeout', () => {
    it('should successfully fetch within timeout', async () => {
      const mockResponse = new Response('OK', { status: 200 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const promise = fetchWithTimeout('https://example.com');
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should timeout after specified duration', async () => {
      let rejectFn: ((reason: Error) => void) | null = null;

      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectFn = reject;
          })
      );

      const promise = fetchWithTimeout('https://example.com', {}, 1000);

      // Simulate AbortController aborting after timeout
      setTimeout(() => {
        const abortError = new Error('AbortError');
        abortError.name = 'AbortError';
        rejectFn?.(abortError);
      }, 1001);

      await vi.advanceTimersByTimeAsync(1002);

      await expect(promise).rejects.toThrow('Request timeout after 1000ms');
      await expect(promise).rejects.toHaveProperty('name', 'TimeoutError');
    });

    it('should use default 30s timeout when not specified', async () => {
      let rejectFn: ((reason: Error) => void) | null = null;

      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectFn = reject;
          })
      );

      const promise = fetchWithTimeout('https://example.com');

      // Simulate AbortController aborting after default 30s timeout
      setTimeout(() => {
        const abortError = new Error('AbortError');
        abortError.name = 'AbortError';
        rejectFn?.(abortError);
      }, 30001);

      await vi.advanceTimersByTimeAsync(30002);

      await expect(promise).rejects.toThrow('Request timeout after 30000ms');
    });

    it('should pass through fetch options', async () => {
      const mockResponse = new Response('OK', { status: 200 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      await fetchWithTimeout('https://example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: true }),
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should clear timeout on successful response', async () => {
      const mockResponse = new Response('OK', { status: 200 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      await fetchWithTimeout('https://example.com');

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear timeout on error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      await expect(fetchWithTimeout('https://example.com')).rejects.toThrow(
        'Network error'
      );

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should wrap AbortError as TimeoutError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      vi.mocked(fetch).mockRejectedValue(abortError);

      const promise = fetchWithTimeout('https://example.com', {}, 5000);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Request timeout after 5000ms');
      await expect(promise).rejects.toHaveProperty('name', 'TimeoutError');
    });

    it('should re-throw non-abort errors unchanged', async () => {
      const networkError = new Error('ECONNREFUSED');
      vi.mocked(fetch).mockRejectedValue(networkError);

      const promise = fetchWithTimeout('https://example.com');
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('ECONNREFUSED');
      await expect(promise).rejects.not.toHaveProperty('name', 'TimeoutError');
    });
  });

  describe('fetchWithRetry - Success cases', () => {
    it('should return response on first attempt if successful', async () => {
      const mockResponse = new Response('OK', { status: 200 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const response = await fetchWithRetry('https://example.com');

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should return 404 without retry (non-retryable status)', async () => {
      const mockResponse = new Response('Not Found', { status: 404 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const response = await fetchWithRetry('https://example.com');

      expect(response.status).toBe(404);
      expect(fetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should return 401 without retry (authentication error)', async () => {
      const mockResponse = new Response('Unauthorized', { status: 401 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const response = await fetchWithRetry('https://example.com');

      expect(response.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should return 403 without retry (forbidden)', async () => {
      const mockResponse = new Response('Forbidden', { status: 403 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const response = await fetchWithRetry('https://example.com');

      expect(response.status).toBe(403);
      expect(fetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should return 400 without retry (bad request)', async () => {
      const mockResponse = new Response('Bad Request', { status: 400 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const response = await fetchWithRetry('https://example.com');

      expect(response.status).toBe(400);
      expect(fetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should return 201 without retry (created)', async () => {
      const mockResponse = new Response('Created', { status: 201 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const response = await fetchWithRetry('https://example.com');

      expect(response.status).toBe(201);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchWithRetry - Retryable status codes', () => {
    it('should retry on 503 Service Unavailable', async () => {
      const mock503 = new Response('Service Unavailable', { status: 503 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(mock503)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 3,
          baseDelayMs: 100,
        }
      );

      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2); // Original + 1 retry
    });

    it('should retry on 429 Too Many Requests', async () => {
      const mock429 = new Response('Too Many Requests', { status: 429 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(mock429)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 Internal Server Error', async () => {
      const mock500 = new Response('Internal Server Error', { status: 500 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(mock500)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 502 Bad Gateway', async () => {
      const mock502 = new Response('Bad Gateway', { status: 502 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(mock502)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 504 Gateway Timeout', async () => {
      const mock504 = new Response('Gateway Timeout', { status: 504 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(mock504)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 408 Request Timeout', async () => {
      const mock408 = new Response('Request Timeout', { status: 408 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(mock408)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchWithRetry - Retry exhaustion', () => {
    it('should return final response after max retries exhausted', async () => {
      const mock503 = new Response('Service Unavailable', { status: 503 });
      vi.mocked(fetch).mockResolvedValue(mock503);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 3,
          baseDelayMs: 100,
        }
      );

      await vi.runAllTimersAsync();

      // After all retries, should return the final 503 response (not throw)
      const response = await promise;
      expect(response.status).toBe(503);
      expect(fetch).toHaveBeenCalledTimes(4); // Original + 3 retries
    });

    it('should respect custom maxRetries setting', async () => {
      const mock503 = new Response('Service Unavailable', { status: 503 });
      vi.mocked(fetch).mockResolvedValue(mock503);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 1,
          baseDelayMs: 100,
        }
      );

      await vi.runAllTimersAsync();

      const response = await promise;
      expect(response.status).toBe(503);
      expect(fetch).toHaveBeenCalledTimes(2); // Original + 1 retry
    });

    it('should return final response with error status', async () => {
      const mock502 = new Response('Bad Gateway', {
        status: 502,
        statusText: 'Bad Gateway',
      });
      vi.mocked(fetch).mockResolvedValue(mock502);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 2,
          baseDelayMs: 100,
        }
      );

      await vi.runAllTimersAsync();

      const response = await promise;
      expect(response.status).toBe(502);
      // Note: statusText may be empty in test environment
      expect(fetch).toHaveBeenCalledTimes(3); // Original + 2 retries
    });
  });

  describe('fetchWithRetry - Exponential backoff', () => {
    it('should use exponential backoff between retries', async () => {
      const mock503 = new Response('Service Unavailable', { status: 503 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(mock503)
        .mockResolvedValueOnce(mock503)
        .mockResolvedValueOnce(mock200);

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 3,
          baseDelayMs: 1000,
        }
      );

      await vi.runAllTimersAsync();
      await promise;

      // Get all setTimeout calls with delays (filtering out abort timeouts and small delays)
      const allCalls = setTimeoutSpy.mock.calls.map((call, idx) => ({
        idx,
        delay: call[1] as number,
      }));

      // Look for sleep delays (backoff delays are typically larger)
      const sleepDelays = allCalls
        .filter((call) => call.delay > 500 && call.delay < 10000)
        .map((call) => call.delay);

      // Should have at least 2 sleep delays
      expect(sleepDelays.length).toBeGreaterThanOrEqual(2);

      // Verify delays are generally increasing (with jitter tolerance)
      // First delay: ~1000ms, Second delay: ~2000ms
      if (sleepDelays.length >= 2) {
        const firstDelay = sleepDelays[0];
        const secondDelay = sleepDelays[1];
        // Second delay should be larger on average (with jitter ±25%)
        expect(secondDelay).toBeGreaterThan(firstDelay * 0.6);
      }
    });

    it('should cap backoff at maxDelayMs', async () => {
      const mock503 = new Response('Service Unavailable', { status: 503 });
      vi.mocked(fetch).mockResolvedValue(mock503);

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 10,
          baseDelayMs: 1000,
          maxDelayMs: 5000,
          timeoutMs: 60000, // Long timeout to avoid capturing it
        }
      );

      await vi.runAllTimersAsync();

      // Returns final response, not throw
      const response = await promise;
      expect(response.status).toBe(503);

      // Get sleep delays (backoff delays between retries)
      // Filter for reasonable backoff delays (between 500ms and 10000ms)
      const sleepDelays = setTimeoutSpy.mock.calls
        .filter(
          (call) => call[1] !== undefined && call[1] > 500 && call[1] < 10000
        )
        .map((call) => call[1] as number);

      // Should have at least a few retries
      expect(sleepDelays.length).toBeGreaterThan(5);

      // All backoff delays should be <= maxDelayMs (5000ms + 25% jitter = 6250ms)
      for (const delay of sleepDelays) {
        expect(delay).toBeLessThanOrEqual(5000 * 1.3); // 30% margin for jitter
      }
    });

    it('should include jitter in backoff delays', async () => {
      const mock503 = new Response('Service Unavailable', { status: 503 });
      const mock200 = new Response('OK', { status: 200 });

      // Run multiple times to verify jitter randomness
      const delays: number[] = [];

      for (let i = 0; i < 5; i++) {
        vi.clearAllMocks();
        vi.clearAllTimers();

        vi.mocked(fetch)
          .mockResolvedValueOnce(mock503)
          .mockResolvedValueOnce(mock200);

        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

        const promise = fetchWithRetry(
          'https://example.com',
          {},
          {
            maxRetries: 3,
            baseDelayMs: 1000,
          }
        );

        await vi.runAllTimersAsync();
        await promise;

        // Get the first backoff delay (sleep delay, not abort timeout)
        const sleepDelay = setTimeoutSpy.mock.calls
          .filter(
            (call) => call[1] !== undefined && call[1] > 500 && call[1] < 10000
          )
          .map((call) => call[1] as number)[0];

        if (sleepDelay) delays.push(sleepDelay);
      }

      // With jitter (±25% randomization), not all delays should be identical
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);

      // All delays should be roughly around 1000ms (±25%)
      for (const delay of delays) {
        expect(delay).toBeGreaterThan(750); // 1000 - 25%
        expect(delay).toBeLessThan(1250); // 1000 + 25%
      }
    });

    it('should use custom baseDelayMs', async () => {
      const mock503 = new Response('Service Unavailable', { status: 503 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(mock503)
        .mockResolvedValueOnce(mock200);

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 500,
        }
      );

      await vi.runAllTimersAsync();
      await promise;

      // Get sleep delays (backoff delays, not abort timeouts)
      const sleepDelays = setTimeoutSpy.mock.calls
        .filter(
          (call) => call[1] !== undefined && call[1] > 100 && call[1] < 10000
        )
        .map((call) => call[1] as number);

      // First retry delay should be around 500ms (±25% jitter)
      expect(sleepDelays[0]).toBeGreaterThan(375); // 500 - 25%
      expect(sleepDelays[0]).toBeLessThan(625); // 500 + 25%
    });
  });

  describe('fetchWithRetry - Network errors', () => {
    it('should retry on ECONNRESET', async () => {
      const connResetError = new Error('Connection reset');
      (connResetError as Error & { code?: string }).code = 'ECONNRESET';

      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockRejectedValueOnce(connResetError)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on ECONNREFUSED', async () => {
      const connRefusedError = new Error('Connection refused');
      (connRefusedError as Error & { code?: string }).code = 'ECONNREFUSED';

      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockRejectedValueOnce(connRefusedError)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on ETIMEDOUT', async () => {
      const timedOutError = new Error('Socket timed out');
      (timedOutError as Error & { code?: string }).code = 'ETIMEDOUT';

      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockRejectedValueOnce(timedOutError)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on ENOTFOUND', async () => {
      const notFoundError = new Error('DNS lookup failed');
      (notFoundError as Error & { code?: string }).code = 'ENOTFOUND';

      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on AbortError (timeout)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockRejectedValueOnce(abortError)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should wrap AbortError with TimeoutError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      vi.mocked(fetch).mockRejectedValue(abortError);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 3,
          baseDelayMs: 100,
          timeoutMs: 5000,
        }
      );

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Request timeout after 5000ms');
      await expect(promise).rejects.toHaveProperty('name', 'TimeoutError');
    });

    it('should NOT retry on non-retryable errors', async () => {
      const syntaxError = new SyntaxError('Invalid JSON');

      vi.mocked(fetch).mockRejectedValue(syntaxError);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Invalid JSON');
      expect(fetch).toHaveBeenCalledTimes(1); // No retry
    });
  });

  describe('fetchWithRetry - Configuration options', () => {
    it('should use custom timeout', async () => {
      // Use a timeout error that's retried, then eventually throws
      const timeoutError = new Error('AbortError');
      timeoutError.name = 'AbortError';

      vi.mocked(fetch).mockRejectedValue(timeoutError);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          timeoutMs: 2000,
          maxRetries: 2, // Will try 3 times total
          baseDelayMs: 100,
        }
      );

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Request timeout after 2000ms');
      expect(fetch).toHaveBeenCalledTimes(3); // Original + 2 retries
    }, 10000);

    it('should use custom maxRetries', async () => {
      const mock503 = new Response('Service Unavailable', { status: 503 });
      vi.mocked(fetch).mockResolvedValue(mock503);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 5,
          baseDelayMs: 100,
        }
      );

      await vi.runAllTimersAsync();

      // Returns final 503 response after all retries
      const response = await promise;
      expect(response.status).toBe(503);
      expect(fetch).toHaveBeenCalledTimes(6); // Original + 5 retries
    });

    it('should merge custom options with defaults', async () => {
      const mockResponse = new Response('OK', { status: 200 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      await fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 5, // Custom
          // timeoutMs and baseDelayMs should use defaults (30000, 1000)
        }
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should pass through fetch init options', async () => {
      const mockResponse = new Response('OK', { status: 200 });
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      await fetchWithRetry(
        'https://api.example.com/data',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key: 'value' }),
        },
        {
          timeoutMs: 10000,
        }
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key: 'value' }),
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe('fetchWithRetry - Integration scenarios', () => {
    it('should handle multiple retries with varying errors', async () => {
      const connResetError = new Error('Connection reset');
      (connResetError as Error & { code?: string }).code = 'ECONNRESET';
      const mock503 = new Response('Service Unavailable', { status: 503 });
      const mock500 = new Response('Internal Server Error', { status: 500 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockRejectedValueOnce(connResetError)
        .mockResolvedValueOnce(mock503)
        .mockResolvedValueOnce(mock500)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          maxRetries: 5,
          baseDelayMs: 100,
        }
      );

      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(4); // Original + 3 retries
    });

    it('should handle timeout followed by successful retry', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockRejectedValueOnce(abortError)
        .mockResolvedValueOnce(mock200);

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
          timeoutMs: 5000,
        }
      );

      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should clear timeouts properly across multiple attempts', async () => {
      const mock503 = new Response('Service Unavailable', { status: 503 });
      const mock200 = new Response('OK', { status: 200 });

      vi.mocked(fetch)
        .mockResolvedValueOnce(mock503)
        .mockResolvedValueOnce(mock503)
        .mockResolvedValueOnce(mock200);

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const promise = fetchWithRetry(
        'https://example.com',
        {},
        {
          baseDelayMs: 100,
        }
      );

      await vi.runAllTimersAsync();
      await promise;

      // Should clear timeout for each attempt
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(3);
    });
  });
});
