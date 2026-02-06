import { describe, expect, it } from 'vitest';
import { getEmbedContext } from '../../commands/status';

describe('getEmbedContext', () => {
  describe('processing status', () => {
    it('should show in-progress message', () => {
      const result = getEmbedContext({
        jobId: 'test',
        status: 'processing',
        retries: 0,
        maxRetries: 3,
      });
      expect(result).toEqual({ message: 'Embedding in progress...' });
    });
  });

  describe('completed status', () => {
    it('should show success message', () => {
      const result = getEmbedContext({
        jobId: 'test',
        status: 'completed',
        retries: 0,
        maxRetries: 3,
      });
      expect(result).toEqual({ message: 'Embedded successfully' });
    });
  });

  describe('failed status', () => {
    it('should show failure message with retry count', () => {
      const result = getEmbedContext({
        jobId: 'test',
        status: 'failed',
        retries: 2,
        maxRetries: 3,
      });
      expect(result).toEqual({
        message: 'Embedding failed',
        metadata: 'retries: 2/3',
      });
    });

    it('should show retry count for first failure', () => {
      const result = getEmbedContext({
        jobId: 'test',
        status: 'failed',
        retries: 0,
        maxRetries: 3,
      });
      expect(result).toEqual({
        message: 'Embedding failed',
        metadata: 'retries: 0/3',
      });
    });

    it('should show retry count at max retries', () => {
      const result = getEmbedContext({
        jobId: 'test',
        status: 'failed',
        retries: 3,
        maxRetries: 3,
      });
      expect(result).toEqual({
        message: 'Embedding failed',
        metadata: 'retries: 3/3',
      });
    });
  });

  describe('pending status without crawl data', () => {
    it('should show queued message', () => {
      const result = getEmbedContext({
        jobId: 'test',
        status: 'pending',
        retries: 0,
        maxRetries: 3,
      });
      expect(result).toEqual({ message: 'Queued for embedding' });
    });
  });

  describe('pending status with crawl data', () => {
    it('should show blocked when crawl failed', () => {
      const result = getEmbedContext(
        { jobId: 'test', status: 'pending', retries: 0, maxRetries: 3 },
        { status: 'failed', completed: 10, total: 100 }
      );
      expect(result).toEqual({ message: 'Blocked (crawl failed)' });
    });

    it('should show blocked when crawl cancelled', () => {
      const result = getEmbedContext(
        { jobId: 'test', status: 'pending', retries: 0, maxRetries: 3 },
        { status: 'cancelled', completed: 50, total: 100 }
      );
      expect(result).toEqual({ message: 'Blocked (crawl failed)' });
    });

    it('should show ready when crawl completed', () => {
      const result = getEmbedContext(
        { jobId: 'test', status: 'pending', retries: 0, maxRetries: 3 },
        { status: 'completed', completed: 200, total: 200 }
      );
      expect(result).toEqual({
        message: 'Ready to embed',
        metadata: '200 documents',
      });
    });

    it('should show ready when crawl completed with partial results', () => {
      const result = getEmbedContext(
        { jobId: 'test', status: 'pending', retries: 0, maxRetries: 3 },
        { status: 'completed', completed: 150, total: 200 }
      );
      expect(result).toEqual({
        message: 'Ready to embed',
        metadata: '200 documents',
      });
    });

    it('should show queued with progress when crawl scraping', () => {
      const result = getEmbedContext(
        { jobId: 'test', status: 'pending', retries: 0, maxRetries: 3 },
        { status: 'scraping', completed: 45, total: 100 }
      );
      expect(result).toEqual({
        message: 'Queued for embedding',
        metadata: 'crawl: 45/100 scraped',
      });
    });

    it('should show queued with progress when crawl processing', () => {
      const result = getEmbedContext(
        { jobId: 'test', status: 'pending', retries: 0, maxRetries: 3 },
        { status: 'processing', completed: 268, total: 1173 }
      );
      expect(result).toEqual({
        message: 'Queued for embedding',
        metadata: 'crawl: 268/1173 scraped',
      });
    });

    it('should show queued with zero progress', () => {
      const result = getEmbedContext(
        { jobId: 'test', status: 'pending', retries: 0, maxRetries: 3 },
        { status: 'scraping', completed: 0, total: 100 }
      );
      expect(result).toEqual({
        message: 'Queued for embedding',
        metadata: 'crawl: 0/100 scraped',
      });
    });

    it('should show queued with unknown crawl status', () => {
      const result = getEmbedContext(
        { jobId: 'test', status: 'pending', retries: 0, maxRetries: 3 },
        { status: 'unknown', completed: 10, total: 100 }
      );
      expect(result).toEqual({
        message: 'Queued for embedding',
        metadata: 'crawl: 10/100 scraped',
      });
    });
  });
});
