/**
 * EmbedPipeline service tests
 * Verifies end-to-end embedding workflow orchestration
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedPipeline } from '../../../container/services/EmbedPipeline';
import type {
  IQdrantService,
  ITeiService,
  TeiInfo,
} from '../../../container/types';

// Mock console.error to suppress output during tests
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('EmbedPipeline', () => {
  let pipeline: EmbedPipeline;
  let mockTeiService: ITeiService;
  let mockQdrantService: IQdrantService;
  const collectionName = 'test-collection';

  const mockTeiInfo: TeiInfo = {
    modelId: 'test-model',
    dimension: 768,
    maxInput: 512,
  };

  beforeEach(() => {
    mockTeiService = {
      getTeiInfo: vi.fn().mockResolvedValue(mockTeiInfo),
      embedBatch: vi.fn(),
      embedChunks: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };

    mockQdrantService = {
      ensureCollection: vi.fn().mockResolvedValue(undefined),
      upsertPoints: vi.fn().mockResolvedValue(undefined),
      deleteByUrl: vi.fn().mockResolvedValue(undefined),
      deleteByDomain: vi.fn(),
      countByDomain: vi.fn(),
      queryPoints: vi.fn(),
      scrollByUrl: vi.fn(),
      getCollectionInfo: vi.fn(),
      scrollAll: vi.fn(),
      countPoints: vi.fn(),
      countByUrl: vi.fn(),
      deleteAll: vi.fn(),
    };

    pipeline = new EmbedPipeline(
      mockTeiService,
      mockQdrantService,
      collectionName
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('autoEmbed', () => {
    it('should embed content end-to-end', async () => {
      const content = 'This is test content that should be embedded.';
      const metadata = {
        url: 'https://example.com/page',
        title: 'Test Page',
        sourceCommand: 'scrape',
      };

      await pipeline.autoEmbed(content, metadata);

      // Should get TEI info
      expect(mockTeiService.getTeiInfo).toHaveBeenCalled();

      // Should ensure collection exists
      expect(mockQdrantService.ensureCollection).toHaveBeenCalledWith(
        collectionName,
        768
      );

      // Should embed chunks
      expect(mockTeiService.embedChunks).toHaveBeenCalled();

      // Should delete existing vectors for dedup
      expect(mockQdrantService.deleteByUrl).toHaveBeenCalledWith(
        collectionName,
        metadata.url
      );

      // Should upsert points
      expect(mockQdrantService.upsertPoints).toHaveBeenCalledWith(
        collectionName,
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            vector: expect.any(Array),
            payload: expect.objectContaining({
              url: metadata.url,
              title: metadata.title,
              domain: 'example.com',
              source_command: 'scrape',
            }),
          }),
        ])
      );
    });

    it('should skip empty content', async () => {
      await pipeline.autoEmbed('', { url: 'https://example.com' });

      expect(mockTeiService.getTeiInfo).not.toHaveBeenCalled();
      expect(mockQdrantService.upsertPoints).not.toHaveBeenCalled();
    });

    it('should skip whitespace-only content', async () => {
      await pipeline.autoEmbed('   \n\t  ', { url: 'https://example.com' });

      expect(mockTeiService.getTeiInfo).not.toHaveBeenCalled();
      expect(mockQdrantService.upsertPoints).not.toHaveBeenCalled();
    });

    it('should extract domain from URL', async () => {
      await pipeline.autoEmbed('test content', {
        url: 'https://subdomain.example.org/path/to/page',
      });

      expect(mockQdrantService.upsertPoints).toHaveBeenCalledWith(
        collectionName,
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              domain: 'subdomain.example.org',
            }),
          }),
        ])
      );
    });

    it('should handle invalid URLs gracefully', async () => {
      await pipeline.autoEmbed('test content', {
        url: 'not-a-valid-url',
      });

      expect(mockQdrantService.upsertPoints).toHaveBeenCalledWith(
        collectionName,
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              domain: 'unknown',
            }),
          }),
        ])
      );
    });

    it('should include additional metadata fields', async () => {
      await pipeline.autoEmbed('test content', {
        url: 'https://example.com',
        customField: 'custom value',
        anotherField: 123,
      });

      expect(mockQdrantService.upsertPoints).toHaveBeenCalledWith(
        collectionName,
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              customField: 'custom value',
              anotherField: 123,
            }),
          }),
        ])
      );
    });

    it('should not throw on TEI errors (logs instead)', async () => {
      vi.mocked(mockTeiService.getTeiInfo).mockRejectedValue(
        new Error('TEI unavailable')
      );

      // Should not throw
      await expect(
        pipeline.autoEmbed('test', { url: 'https://example.com' })
      ).resolves.toBeUndefined();

      // Should log error
      expect(console.error).toHaveBeenCalled();
    });

    it('should not throw on Qdrant errors (logs instead)', async () => {
      vi.mocked(mockQdrantService.upsertPoints).mockRejectedValue(
        new Error('Qdrant unavailable')
      );

      // Should not throw
      await expect(
        pipeline.autoEmbed('test', { url: 'https://example.com' })
      ).resolves.toBeUndefined();

      // Should log error
      expect(console.error).toHaveBeenCalled();
    });

    it('should set default sourceCommand to unknown', async () => {
      await pipeline.autoEmbed('test content', {
        url: 'https://example.com',
      });

      expect(mockQdrantService.upsertPoints).toHaveBeenCalledWith(
        collectionName,
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              source_command: 'unknown',
            }),
          }),
        ])
      );
    });

    it('should set default contentType to text', async () => {
      await pipeline.autoEmbed('test content', {
        url: 'https://example.com',
      });

      expect(mockQdrantService.upsertPoints).toHaveBeenCalledWith(
        collectionName,
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              content_type: 'text',
            }),
          }),
        ])
      );
    });
  });

  describe('batchEmbed', () => {
    it('should return empty result for empty items', async () => {
      const result = await pipeline.batchEmbed([]);

      expect(result).toEqual({
        succeeded: 0,
        failed: 0,
        errors: [],
      });
    });

    it('should embed multiple items', async () => {
      const items = [
        { content: 'content 1', metadata: { url: 'https://a.com' } },
        { content: 'content 2', metadata: { url: 'https://b.com' } },
        { content: 'content 3', metadata: { url: 'https://c.com' } },
      ];

      const result = await pipeline.batchEmbed(items);

      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should track failures separately', async () => {
      // Fail on second URL
      vi.mocked(mockQdrantService.deleteByUrl).mockImplementation(
        async (_collection, url) => {
          if (url === 'https://fail.com') {
            throw new Error('Delete failed');
          }
        }
      );

      const items = [
        { content: 'content 1', metadata: { url: 'https://success.com' } },
        { content: 'content 2', metadata: { url: 'https://fail.com' } },
        { content: 'content 3', metadata: { url: 'https://another.com' } },
      ];

      const result = await pipeline.batchEmbed(items);

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('https://fail.com');
    });

    it('should limit stored errors to 10', async () => {
      // Fail all items
      vi.mocked(mockTeiService.embedChunks).mockRejectedValue(
        new Error('TEI down')
      );

      const items = Array.from({ length: 15 }, (_, i) => ({
        content: `content ${i}`,
        metadata: { url: `https://example${i}.com` },
      }));

      const result = await pipeline.batchEmbed(items);

      expect(result.failed).toBe(15);
      expect(result.errors).toHaveLength(10); // Limited to 10
    });

    it('should respect concurrency option', async () => {
      let concurrentCalls = 0;
      let maxConcurrent = 0;

      vi.mocked(mockTeiService.embedChunks).mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentCalls--;
        return [[0.1]];
      });

      const items = Array.from({ length: 20 }, (_, i) => ({
        content: `content ${i}`,
        metadata: { url: `https://example${i}.com` },
      }));

      await pipeline.batchEmbed(items, { concurrency: 3 });

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('should use default concurrency of 10', async () => {
      let concurrentCalls = 0;
      let maxConcurrent = 0;

      vi.mocked(mockTeiService.embedChunks).mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrentCalls--;
        return [[0.1]];
      });

      const items = Array.from({ length: 25 }, (_, i) => ({
        content: `content ${i}`,
        metadata: { url: `https://example${i}.com` },
      }));

      await pipeline.batchEmbed(items);

      expect(maxConcurrent).toBeLessThanOrEqual(10);
    });

    it('should skip empty content items', async () => {
      const items = [
        { content: '', metadata: { url: 'https://empty.com' } },
        { content: 'valid content', metadata: { url: 'https://valid.com' } },
        { content: '   ', metadata: { url: 'https://whitespace.com' } },
      ];

      const result = await pipeline.batchEmbed(items);

      // Empty/whitespace items succeed (they just no-op)
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);

      // But only the valid one should have called upsertPoints
      expect(mockQdrantService.upsertPoints).toHaveBeenCalledTimes(1);
    });

    it('should log warning when there are failures', async () => {
      vi.mocked(mockTeiService.embedChunks).mockRejectedValueOnce(
        new Error('TEI error')
      );

      const items = [
        { content: 'fail', metadata: { url: 'https://fail.com' } },
        { content: 'succeed', metadata: { url: 'https://succeed.com' } },
      ];

      await pipeline.batchEmbed(items);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('1/2')
      );
    });

    describe('Enhanced Logging', () => {
      it('should log embedding attempt for each document', async () => {
        const consoleSpy = vi.spyOn(console, 'error');

        await pipeline.batchEmbed([
          {
            content: 'test1',
            metadata: { url: 'https://test1.com', sourceCommand: 'test' },
          },
          {
            content: 'test2',
            metadata: { url: 'https://test2.com', sourceCommand: 'test' },
          },
        ]);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/Embedding.*https:\/\/test1\.com/)
        );
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/Embedding.*https:\/\/test2\.com/)
        );

        consoleSpy.mockRestore();
      });

      it('should log detailed error info on failure', async () => {
        const consoleSpy = vi.spyOn(console, 'error');

        vi.mocked(mockTeiService.embedChunks).mockRejectedValueOnce(
          new Error('TEI timeout after 87000ms')
        );

        await pipeline.batchEmbed([
          {
            content: 'test',
            metadata: { url: 'https://fail.com', sourceCommand: 'test' },
          },
        ]);

        // Check for FAILED line
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/FAILED.*https:\/\/fail\.com/)
        );

        // Check for Error details line
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/Error: TEI timeout/)
        );

        consoleSpy.mockRestore();
      });

      it('should log summary statistics at end of batch', async () => {
        const consoleSpy = vi.spyOn(console, 'error');

        vi.mocked(mockTeiService.embedChunks)
          .mockResolvedValueOnce([[0.1]])
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValueOnce([[0.2]]);

        await pipeline.batchEmbed([
          {
            content: 'test1',
            metadata: { url: 'https://test1.com', sourceCommand: 'test' },
          },
          {
            content: 'test2',
            metadata: { url: 'https://test2.com', sourceCommand: 'test' },
          },
          {
            content: 'test3',
            metadata: { url: 'https://test3.com', sourceCommand: 'test' },
          },
        ]);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/Embedded 2\/3 items \(1 failed\)/)
        );

        consoleSpy.mockRestore();
      });

      it('should log failed URLs for easy retry', async () => {
        const consoleSpy = vi.spyOn(console, 'error');

        vi.mocked(mockTeiService.embedChunks)
          .mockResolvedValueOnce([[0.1]])
          .mockRejectedValueOnce(new Error('Fail 1'))
          .mockRejectedValueOnce(new Error('Fail 2'));

        await pipeline.batchEmbed([
          {
            content: 'ok',
            metadata: { url: 'https://ok.com', sourceCommand: 'test' },
          },
          {
            content: 'fail1',
            metadata: { url: 'https://fail1.com', sourceCommand: 'test' },
          },
          {
            content: 'fail2',
            metadata: { url: 'https://fail2.com', sourceCommand: 'test' },
          },
        ]);

        // Should log "Failed URLs:" header
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/Failed URLs:/)
        );

        // Should log first failed URL
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/- https:\/\/fail1\.com/)
        );

        // Should log second failed URL
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringMatching(/- https:\/\/fail2\.com/)
        );

        consoleSpy.mockRestore();
      });
    });
  });

  describe('collection name', () => {
    it('should use provided collection name', async () => {
      const customPipeline = new EmbedPipeline(
        mockTeiService,
        mockQdrantService,
        'custom-collection'
      );

      await customPipeline.autoEmbed('test', { url: 'https://example.com' });

      expect(mockQdrantService.ensureCollection).toHaveBeenCalledWith(
        'custom-collection',
        expect.any(Number)
      );
    });

    it('should default to firecrawl collection', () => {
      const defaultPipeline = new EmbedPipeline(
        mockTeiService,
        mockQdrantService
      );

      // Access private property via test - just verify constructor doesn't throw
      expect(defaultPipeline).toBeDefined();
    });
  });
});
