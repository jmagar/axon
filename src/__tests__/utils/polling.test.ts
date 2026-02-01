import { describe, expect, it, vi } from 'vitest';
import { pollWithProgress } from '../../utils/polling';

describe('pollWithProgress', () => {
  it('should poll immediately without initial delay', async () => {
    const startTime = Date.now();
    const statusFetcher = vi.fn(async () => ({ status: 'completed' }));

    await pollWithProgress({
      jobId: 'test-job',
      statusFetcher,
      pollInterval: 1000,
      isComplete: (s) => s.status === 'completed',
      formatProgress: (s) => 'Progress',
    });

    const elapsed = Date.now() - startTime;
    // Should complete immediately (< 100ms), not after pollInterval (1000ms)
    expect(elapsed).toBeLessThan(100);
    expect(statusFetcher).toHaveBeenCalledTimes(1);
  });

  it('should poll until completion', async () => {
    let callCount = 0;
    const statusFetcher = vi.fn(async () => {
      callCount++;
      return {
        status: callCount >= 3 ? 'completed' : 'processing',
        count: callCount,
      };
    });

    const result = await pollWithProgress({
      jobId: 'test-job',
      statusFetcher,
      pollInterval: 100,
      isComplete: (s) => s.status === 'completed',
      formatProgress: (s) => `Progress: ${s.count}`,
    });

    expect(result.status).toBe('completed');
    expect(result.count).toBe(3);
    expect(statusFetcher).toHaveBeenCalledTimes(3);
    expect(statusFetcher).toHaveBeenCalledWith('test-job');
  });

  it('should timeout if not completed', async () => {
    const statusFetcher = vi.fn(async () => ({ status: 'processing' }));

    await expect(
      pollWithProgress({
        jobId: 'test-job',
        statusFetcher,
        pollInterval: 50,
        timeout: 200,
        isComplete: (s) => s.status === 'completed',
        formatProgress: (s) => 'Progress',
      })
    ).rejects.toThrow('Timeout after 0.2 seconds');

    // Should have called multiple times before timeout
    expect(statusFetcher.mock.calls.length).toBeGreaterThan(0);
  });

  it('should complete immediately if first poll is complete', async () => {
    const statusFetcher = vi.fn(async () => ({
      status: 'completed',
      data: 'result',
    }));

    const result = await pollWithProgress({
      jobId: 'test-job',
      statusFetcher,
      pollInterval: 100,
      isComplete: (s) => s.status === 'completed',
      formatProgress: (s) => 'Progress',
    });

    expect(result.status).toBe('completed');
    expect(result.data).toBe('result');
    expect(statusFetcher).toHaveBeenCalledTimes(1);
  });

  it('should work without timeout', async () => {
    let callCount = 0;
    const statusFetcher = vi.fn(async () => {
      callCount++;
      return { status: callCount >= 2 ? 'done' : 'pending' };
    });

    const result = await pollWithProgress({
      jobId: 'test-job',
      statusFetcher,
      pollInterval: 50,
      // No timeout specified
      isComplete: (s) => s.status === 'done',
      formatProgress: (s) => s.status,
    });

    expect(result.status).toBe('done');
    expect(statusFetcher).toHaveBeenCalledTimes(2);
  });

  it('should work without progress display', async () => {
    let callCount = 0;
    const statusFetcher = vi.fn(async () => {
      callCount++;
      return { status: callCount >= 2 ? 'finished' : 'running' };
    });

    const result = await pollWithProgress({
      jobId: 'test-job',
      statusFetcher,
      pollInterval: 50,
      showProgress: false,
      isComplete: (s) => s.status === 'finished',
      formatProgress: (s) => s.status,
    });

    expect(result.status).toBe('finished');
  });

  it('should pass jobId to statusFetcher', async () => {
    const statusFetcher = vi.fn(async (id: string) => ({
      status: 'completed',
      jobId: id,
    }));

    const result = await pollWithProgress({
      jobId: 'custom-job-123',
      statusFetcher,
      pollInterval: 50,
      isComplete: (s) => s.status === 'completed',
      formatProgress: (s) => 'Progress',
    });

    expect(statusFetcher).toHaveBeenCalledWith('custom-job-123');
    expect(result.jobId).toBe('custom-job-123');
  });

  it('should handle custom completion logic', async () => {
    let callCount = 0;
    const statusFetcher = vi.fn(async () => {
      callCount++;
      return {
        total: 10,
        completed: callCount * 3,
      };
    });

    const result = await pollWithProgress({
      jobId: 'test-job',
      statusFetcher,
      pollInterval: 50,
      isComplete: (s) => s.completed >= s.total,
      formatProgress: (s) => `${s.completed}/${s.total}`,
    });

    expect(result.completed).toBeGreaterThanOrEqual(result.total);
    expect(statusFetcher).toHaveBeenCalledTimes(4); // 3, 6, 9, 12
  });

  it('should handle errors from statusFetcher', async () => {
    const statusFetcher = vi.fn(async (): Promise<{ status: string }> => {
      throw new Error('Network error');
    });

    await expect(
      pollWithProgress({
        jobId: 'test-job',
        statusFetcher,
        pollInterval: 50,
        isComplete: (s: { status: string }) => s.status === 'completed',
        formatProgress: (s: { status: string }) => 'Progress',
      })
    ).rejects.toThrow('Failed to fetch status: Network error');
  });

  it('should respect exact poll interval timing', async () => {
    const pollInterval = 100;
    let lastTime = Date.now();
    const times: number[] = [];

    const statusFetcher = vi.fn(async () => {
      const now = Date.now();
      times.push(now - lastTime);
      lastTime = now;
      return { status: times.length >= 3 ? 'completed' : 'processing' };
    });

    await pollWithProgress({
      jobId: 'test-job',
      statusFetcher,
      pollInterval,
      isComplete: (s) => s.status === 'completed',
      formatProgress: (s) => 'Progress',
    });

    // First poll should be immediate (< 20ms)
    expect(times[0]).toBeLessThan(20);

    // Subsequent intervals should be approximately pollInterval ms (with some tolerance)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(pollInterval - 20); // 20ms tolerance
      expect(times[i]).toBeLessThan(pollInterval + 50); // 50ms tolerance
    }
  });

  it('should reject zero timeout', async () => {
    const statusFetcher = vi.fn(async () => ({ status: 'processing' }));

    await expect(
      pollWithProgress({
        jobId: 'test-job',
        statusFetcher,
        pollInterval: 50,
        timeout: 0,
        isComplete: (s) => s.status === 'completed',
        formatProgress: (s) => 'Progress',
      })
    ).rejects.toThrow('Timeout must be a positive number');
  });

  it('should reject negative timeout', async () => {
    const statusFetcher = vi.fn(async () => ({ status: 'processing' }));

    await expect(
      pollWithProgress({
        jobId: 'test-job',
        statusFetcher,
        pollInterval: 50,
        timeout: -1000,
        isComplete: (s) => s.status === 'completed',
        formatProgress: (s) => 'Progress',
      })
    ).rejects.toThrow('Timeout must be a positive number');
  });
});
