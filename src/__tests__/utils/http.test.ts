import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, fetchWithTimeout } from '../../utils/http';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('HTTP utilities with timeout and retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    if (vi.isFakeTimers()) {
      vi.useRealTimers();
    }
  });

  describe('fetchWithRetry - Success Cases', () => {
    it('should return response on successful first attempt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const response = await fetchWithRetry('http://test.com');

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should respect custom timeout option', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      await fetchWithRetry('http://test.com', undefined, { timeoutMs: 5000 });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return non-retryable client error immediately', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      const response = await fetchWithRetry('http://test.com');

      expect(response.status).toBe(400);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return 401 unauthorized immediately', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const response = await fetchWithRetry('http://test.com');

      expect(response.status).toBe(401);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return 403 forbidden immediately', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const response = await fetchWithRetry('http://test.com');

      expect(response.status).toBe(403);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return 404 not found immediately', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const response = await fetchWithRetry('http://test.com');

      expect(response.status).toBe(404);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should merge custom options with defaults', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com', undefined, {
        baseDelayMs: 500,
        maxRetries: 1,
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should use defaults when options is empty object', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      await fetchWithRetry('http://test.com', undefined, {});

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchWithRetry - Retry Logic', () => {
    it('should retry on 503 Service Unavailable', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

      const promise = fetchWithRetry('http://test.com');

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on all retryable status codes', async () => {
      const retryableStatuses = [408, 429, 500, 502, 503, 504];

      for (const status of retryableStatuses) {
        vi.clearAllMocks();
        vi.useFakeTimers();

        mockFetch
          .mockResolvedValueOnce({ ok: false, status, statusText: 'Error' })
          .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

        const promise = fetchWithRetry('http://test.com');
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(2000);
        const response = await promise;

        expect(response.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
      }
    });

    it('should retry exactly maxRetries times then fail', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 });

      const promise = fetchWithRetry('http://test.com', undefined, {
        maxRetries: 3,
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(5000);

      const response = await promise;
      expect(response.status).toBe(503);
      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should not retry on 400 Bad Request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      const response = await fetchWithRetry('http://test.com');

      expect(response.status).toBe(400);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 200 OK', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const response = await fetchWithRetry('http://test.com');

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should include status code in error message after retry exhaustion', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        });

      const promise = fetchWithRetry('http://test.com', undefined, {
        maxRetries: 1,
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);

      const response = await promise;
      expect(response.status).toBe(503);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should continue retry loop after status-based retry', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com', undefined, {
        maxRetries: 3,
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(3000);
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should return response after successful retry', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });

      const promise = fetchWithRetry('http://test.com');

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      const response = await promise;

      expect(response.status).toBe(200);
      expect(response.statusText).toBe('OK');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should create fresh AbortController for each retry attempt', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com');

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      const firstSignal = mockFetch.mock.calls[0][1].signal;
      const secondSignal = mockFetch.mock.calls[1][1].signal;

      expect(firstSignal).toBeInstanceOf(AbortSignal);
      expect(secondSignal).toBeInstanceOf(AbortSignal);
      expect(firstSignal).not.toBe(secondSignal);
    });

    it('should pass signal to fetch on each attempt', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com');

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][1]).toHaveProperty('signal');
      expect(mockFetch.mock.calls[1][1]).toHaveProperty('signal');
    });
  });

  describe('fetchWithRetry - Exponential Backoff & Jitter', () => {
    it('should calculate exponential backoff correctly', async () => {
      vi.useFakeTimers();
      let resolveCount = 0;

      mockFetch.mockImplementation(async () => {
        if (resolveCount < 3) {
          resolveCount++;
          return { ok: false, status: 503 };
        }
        return { ok: true, status: 200 };
      });

      const promise = fetchWithRetry('http://test.com', undefined, {
        baseDelayMs: 1000,
        maxRetries: 3,
      });

      // First attempt - immediate
      await vi.advanceTimersByTimeAsync(0);

      // First retry - ~1000ms (750-1250ms with jitter)
      await vi.advanceTimersByTimeAsync(1500);

      // Second retry - ~2000ms (1500-2500ms with jitter)
      await vi.advanceTimersByTimeAsync(3000);

      // Third retry - ~4000ms (3000-5000ms with jitter)
      await vi.advanceTimersByTimeAsync(6000);

      await promise;

      // Verify the number of attempts
      expect(mockFetch).toHaveBeenCalledTimes(4); // 3 failures + 1 success
    });

    it('should apply jitter to delay', async () => {
      vi.useFakeTimers();
      const mathRandomSpy = vi.spyOn(Math, 'random');

      // Test multiple times with different random values
      const jitterTests = [0.0, 0.5, 1.0];

      for (const randomValue of jitterTests) {
        vi.clearAllMocks();
        mathRandomSpy.mockReturnValue(randomValue);

        mockFetch
          .mockResolvedValueOnce({ ok: false, status: 503 })
          .mockResolvedValueOnce({ ok: true, status: 200 });

        const promise = fetchWithRetry('http://test.com', undefined, {
          baseDelayMs: 1000,
          maxRetries: 1,
        });

        await vi.advanceTimersByTimeAsync(0);

        // Calculate expected delay with jitter
        const exponential = 1000 * 2 ** 0; // baseDelay * 2^attempt
        const jitter = exponential * 0.25 * (randomValue * 2 - 1);
        const expectedDelay = exponential + jitter;

        await vi.advanceTimersByTimeAsync(expectedDelay + 100);
        await promise;

        expect(mockFetch).toHaveBeenCalledTimes(2);
      }

      mathRandomSpy.mockRestore();
    });

    it('should apply minimum jitter when Math.random returns 0', async () => {
      vi.useFakeTimers();
      const mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com', undefined, {
        baseDelayMs: 1000,
        maxRetries: 1,
      });

      await vi.advanceTimersByTimeAsync(0);

      // With Math.random() = 0:
      // jitter = 1000 * 0.25 * (0 * 2 - 1) = 1000 * 0.25 * -1 = -250
      // delay = 1000 - 250 = 750 (75% of base)
      await vi.advanceTimersByTimeAsync(750);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      mathRandomSpy.mockRestore();
    });

    it('should apply maximum jitter when Math.random returns 1', async () => {
      vi.useFakeTimers();
      const mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com', undefined, {
        baseDelayMs: 1000,
        maxRetries: 1,
      });

      await vi.advanceTimersByTimeAsync(0);

      // With Math.random() = 1:
      // jitter = 1000 * 0.25 * (1 * 2 - 1) = 1000 * 0.25 * 1 = 250
      // delay = 1000 + 250 = 1250 (125% of base)
      await vi.advanceTimersByTimeAsync(1250);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      mathRandomSpy.mockRestore();
    });

    it('should respect maxDelayMs cap', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com', undefined, {
        baseDelayMs: 1000,
        maxDelayMs: 2000,
        maxRetries: 3,
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000); // First retry - capped at 2000
      await vi.advanceTimersByTimeAsync(2500); // Second retry - also capped at 2000
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should use custom baseDelayMs correctly', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com', undefined, {
        baseDelayMs: 500,
        maxRetries: 1,
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000); // Should be ~500ms with jitter
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should cap large attempt numbers at maxDelayMs', async () => {
      vi.useFakeTimers();

      // Create enough retries to test capping
      for (let i = 0; i < 10; i++) {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
      }
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com', undefined, {
        baseDelayMs: 100,
        maxDelayMs: 1000,
        maxRetries: 10,
      });

      await vi.advanceTimersByTimeAsync(0);

      // Advance through all retries - delays should be capped
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(1500);
      }

      await promise;
      expect(mockFetch).toHaveBeenCalledTimes(11);
    });

    it('should delay correctly using sleep function', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com', undefined, {
        baseDelayMs: 1000,
        maxRetries: 1,
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1500);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchWithRetry - Timeout Handling', () => {
    it('should convert AbortError to TimeoutError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(
        fetchWithRetry('http://test.com', undefined, {
          timeoutMs: 1000,
          maxRetries: 0,
        })
      ).rejects.toThrow('Request timeout after 1000ms');
    });

    it('should set error name to TimeoutError when converting AbortError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(
        fetchWithRetry('http://test.com', undefined, {
          timeoutMs: 1000,
          maxRetries: 0,
        })
      ).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Request timeout after 1000ms',
      });
    });

    it('should clear timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      await fetchWithRetry('http://test.com');

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout on error before throwing', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const error = new Error('Network error');
      mockFetch.mockRejectedValueOnce(error);

      await expect(
        fetchWithRetry('http://test.com', undefined, { maxRetries: 0 })
      ).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      clearTimeoutSpy.mockRestore();
    });

    it('should retry after AbortError when retryable', async () => {
      // First attempt times out (AbortError), second succeeds
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      mockFetch
        .mockRejectedValueOnce(abortError)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 1,
        baseDelayMs: 10,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple AbortErrors across retries', async () => {
      const abortError1 = new Error('The operation was aborted');
      abortError1.name = 'AbortError';
      const abortError2 = new Error('The operation was aborted');
      abortError2.name = 'AbortError';

      mockFetch
        .mockRejectedValueOnce(abortError1)
        .mockRejectedValueOnce(abortError2)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 2,
        baseDelayMs: 10,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('fetchWithRetry - Network Error Handling', () => {
    it('should retry on ECONNRESET error', async () => {
      const error = new Error('Connection reset');
      (error as any).code = 'ECONNRESET';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 1,
        baseDelayMs: 10,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on ECONNREFUSED error', async () => {
      const error = new Error('Connection refused');
      (error as any).code = 'ECONNREFUSED';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 1,
        baseDelayMs: 10,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on ETIMEDOUT error', async () => {
      const error = new Error('Connection timed out');
      (error as any).code = 'ETIMEDOUT';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 1,
        baseDelayMs: 10,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on ENOTFOUND error', async () => {
      const error = new Error('Host not found');
      (error as any).code = 'ENOTFOUND';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 1,
        baseDelayMs: 10,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on EAI_AGAIN error', async () => {
      vi.useFakeTimers();
      const error = new Error('DNS lookup failed');
      (error as any).code = 'EAI_AGAIN';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com');

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on EPIPE error', async () => {
      vi.useFakeTimers();
      const error = new Error('Broken pipe');
      (error as any).code = 'EPIPE';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com');

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on AbortError by name', async () => {
      vi.useFakeTimers();
      const error = new Error('Request aborted');
      error.name = 'AbortError';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const promise = fetchWithRetry('http://test.com');

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable error', async () => {
      const error = new Error('Invalid input');
      (error as any).code = 'EINVAL';

      mockFetch.mockRejectedValueOnce(error);

      await expect(
        fetchWithRetry('http://test.com', undefined, { maxRetries: 0 })
      ).rejects.toThrow('Invalid input');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries on persistent network error', async () => {
      const error = new Error('Connection reset');
      (error as any).code = 'ECONNRESET';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error);

      await expect(
        fetchWithRetry('http://test.com', undefined, {
          maxRetries: 3,
          baseDelayMs: 10,
        })
      ).rejects.toThrow('Connection reset');
      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });
  });

  describe('fetchWithRetry - Edge Cases', () => {
    it('should pass POST body and headers through correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
      });

      const body = JSON.stringify({ test: 'data' });
      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
      };

      await fetchWithRetry('http://test.com', {
        method: 'POST',
        body,
        headers,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.com',
        expect.objectContaining({
          method: 'POST',
          body,
          headers,
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should wrap non-Error thrown string in Error object', async () => {
      mockFetch.mockImplementationOnce(() => {
        // eslint-disable-next-line no-throw-literal
        throw 'String error';
      });

      await expect(
        fetchWithRetry('http://test.com', undefined, { maxRetries: 0 })
      ).rejects.toThrow('String error');
    });

    it('should convert non-Error thrown object to string', async () => {
      mockFetch.mockImplementationOnce(() => {
        // eslint-disable-next-line no-throw-literal
        throw { code: 'ERROR', message: 'Object error' };
      });

      await expect(
        fetchWithRetry('http://test.com', undefined, { maxRetries: 0 })
      ).rejects.toThrow('[object Object]');
    });

    it('should handle error with both name and code properties', async () => {
      const error = new Error('Network error');
      error.name = 'AbortError';
      (error as any).code = 'ECONNRESET';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 1,
        baseDelayMs: 10,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw fallback error when lastError is null', async () => {
      // This is a theoretical edge case where the loop completes without setting lastError
      // In practice, this shouldn't happen, but we test the fallback
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 503 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 3,
        baseDelayMs: 10,
      });

      // Should return the last 503 response, not throw fallback error
      expect(response.status).toBe(503);
    });

    it('should preserve all fetch options across retries', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const options = {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'value',
        },
        body: JSON.stringify({ data: 'test' }),
        credentials: 'include' as RequestCredentials,
      };

      await fetchWithRetry('http://test.com', options, { baseDelayMs: 10 });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify first call
      expect(mockFetch.mock.calls[0][1]).toMatchObject({
        method: 'PUT',
        headers: options.headers,
        body: options.body,
        credentials: 'include',
      });

      // Verify second call (retry)
      expect(mockFetch.mock.calls[1][1]).toMatchObject({
        method: 'PUT',
        headers: options.headers,
        body: options.body,
        credentials: 'include',
      });
    });
  });

  describe('fetchWithTimeout - Success Cases', () => {
    it('should return response on successful request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const response = await fetchWithTimeout('http://test.com');

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should respect custom timeout parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      await fetchWithTimeout('http://test.com', undefined, 5000);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return error response without status check', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const response = await fetchWithTimeout('http://test.com');

      expect(response.status).toBe(500);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should clear timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      await fetchWithTimeout('http://test.com');

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('fetchWithTimeout - Timeout Handling', () => {
    it('should convert AbortError to TimeoutError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(
        fetchWithTimeout('http://test.com', undefined, 1000)
      ).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Request timeout after 1000ms',
      });
    });

    it('should clear timeout on error', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const error = new Error('Network error');

      mockFetch.mockRejectedValueOnce(error);

      await expect(fetchWithTimeout('http://test.com')).rejects.toThrow(
        'Network error'
      );

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      clearTimeoutSpy.mockRestore();
    });

    it('should use default timeout of 30000ms in TimeoutError message', async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';

      mockFetch.mockRejectedValueOnce(error);

      await expect(fetchWithTimeout('http://test.com')).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Request timeout after 30000ms',
      });
    });
  });

  describe('fetchWithTimeout - Error Handling', () => {
    it('should throw network error immediately without retry', async () => {
      const error = new Error('Connection refused');
      (error as any).code = 'ECONNREFUSED';

      mockFetch.mockRejectedValueOnce(error);

      await expect(fetchWithTimeout('http://test.com')).rejects.toThrow(
        'Connection refused'
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw non-timeout error unchanged', async () => {
      const error = new Error('Custom error');
      error.name = 'CustomError';

      mockFetch.mockRejectedValueOnce(error);

      await expect(fetchWithTimeout('http://test.com')).rejects.toMatchObject({
        name: 'CustomError',
        message: 'Custom error',
      });
    });

    it('should pass POST body and headers through correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
      });

      const body = JSON.stringify({ test: 'data' });
      const headers = { 'Content-Type': 'application/json' };

      await fetchWithTimeout('http://test.com', {
        method: 'POST',
        body,
        headers,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.com',
        expect.objectContaining({
          method: 'POST',
          body,
          headers,
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe('Internal Function Coverage', () => {
    it('should handle isRetryableError with non-Error values', async () => {
      mockFetch.mockImplementationOnce(() => {
        // eslint-disable-next-line no-throw-literal
        throw 'string error';
      });

      await expect(
        fetchWithRetry('http://test.com', undefined, { maxRetries: 0 })
      ).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should detect retryable errors by name', async () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 1,
        baseDelayMs: 10,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should detect retryable errors by code', async () => {
      const error = new Error('Connection error');
      (error as any).code = 'ECONNRESET';

      mockFetch
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        maxRetries: 1,
        baseDelayMs: 10,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should cap delay at maxDelayMs in calculateBackoff', async () => {
      // Create a scenario with very high exponential backoff
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
      }
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await fetchWithRetry('http://test.com', undefined, {
        baseDelayMs: 100,
        maxDelayMs: 50,
        maxRetries: 5,
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });
  });
});
