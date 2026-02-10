/**
 * Tests for job history utilities
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearJobHistory,
  getRecentJobIds,
  recordJob,
  removeJobIds,
} from '../../utils/job-history';

// Mock fs.promises module
vi.mock('node:fs', () => ({
  promises: {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Mock os module
vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

// Mock process.cwd for testing legacy path
const originalCwd = process.cwd;
let mockCwd = '/test/working/directory';

describe('Job History Utilities', () => {
  const mockHome = '/home/testuser';
  const expectedDataDir = join(mockHome, '.firecrawl');
  const expectedHistoryPath = join(expectedDataDir, 'job-history.json');
  const legacyPath = join(mockCwd, '.cache', 'job-history.json');
  const originalFirecrawlHome = process.env.FIRECRAWL_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(homedir).mockReturnValue(mockHome);
    process.cwd = vi.fn(() => mockCwd) as () => string;
    delete process.env.FIRECRAWL_HOME;
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.cwd = originalCwd;
    process.env.FIRECRAWL_HOME = originalFirecrawlHome;
  });

  describe('Storage root support', () => {
    it('should use default ~/.firecrawl path when FIRECRAWL_HOME is not set', async () => {
      // Mock empty history file
      vi.mocked(fs.access).mockImplementation(async (path) => {
        if (path === expectedHistoryPath) return;
        if (path === legacyPath) throw new Error('not found');
        throw new Error('not found');
      });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ crawl: [], batch: [], extract: [] })
      );

      await getRecentJobIds('crawl');

      expect(fs.access).toHaveBeenCalledWith(expectedHistoryPath);
    });

    it('should create directory with secure permissions (0o700)', async () => {
      // Mock directory doesn't exist
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await recordJob('crawl', 'test-job-id');

      expect(fs.mkdir).toHaveBeenCalledWith(expectedDataDir, {
        recursive: true,
        mode: 0o700,
      });
    });
  });

  describe('Legacy Migration', () => {
    it('should migrate from legacy .cache directory', async () => {
      const legacyData = {
        crawl: [
          { id: 'old-crawl-1', updatedAt: '2024-01-01T00:00:00.000Z' },
          { id: 'old-crawl-2', updatedAt: '2024-01-02T00:00:00.000Z' },
        ],
        batch: [{ id: 'old-batch-1', updatedAt: '2024-01-03T00:00:00.000Z' }],
        extract: [],
      };

      let newFileCreated = false;

      // Mock legacy file exists, new file doesn't initially
      vi.mocked(fs.access).mockImplementation(async (path) => {
        if (path === legacyPath) return; // Legacy exists
        if (path === expectedHistoryPath && !newFileCreated)
          throw new Error('not found'); // New doesn't exist initially
        if (path === expectedHistoryPath && newFileCreated) return; // New exists after migration
        if (path === expectedDataDir) throw new Error('not found'); // Dir doesn't exist
        throw new Error('not found');
      });

      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (path === legacyPath) {
          return JSON.stringify(legacyData);
        }
        if (path === expectedHistoryPath && newFileCreated) {
          return JSON.stringify(legacyData);
        }
        throw new Error('not found');
      });

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockImplementation(async () => {
        newFileCreated = true;
      });

      const result = await getRecentJobIds('crawl');

      // Should have migrated data
      expect(result).toEqual(['old-crawl-1', 'old-crawl-2']);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expectedHistoryPath,
        JSON.stringify(legacyData)
      );
    });

    it('should not print migration messages to stdout', async () => {
      const legacyData = {
        crawl: [{ id: 'old-crawl-1', updatedAt: '2024-01-01T00:00:00.000Z' }],
        batch: [],
        extract: [],
      };

      let newFileCreated = false;
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(fs.access).mockImplementation(async (path) => {
        if (path === legacyPath) return;
        if (path === expectedHistoryPath && !newFileCreated) {
          throw new Error('not found');
        }
        if (path === expectedHistoryPath && newFileCreated) return;
        if (path === expectedDataDir) throw new Error('not found');
        throw new Error('not found');
      });

      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (
          path === legacyPath ||
          (path === expectedHistoryPath && newFileCreated)
        ) {
          return JSON.stringify(legacyData);
        }
        throw new Error('not found');
      });

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockImplementation(async () => {
        newFileCreated = true;
      });

      await getRecentJobIds('crawl');

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.[0]).toContain('[Job History] Migrated');

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should not migrate if new file already exists', async () => {
      const newData = {
        crawl: [{ id: 'new-crawl-1', updatedAt: '2024-02-01T00:00:00.000Z' }],
        batch: [],
        extract: [],
      };

      // Mock both files exist
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (path === expectedHistoryPath) {
          return JSON.stringify(newData);
        }
        throw new Error('not found');
      });

      const result = await getRecentJobIds('crawl');

      // Should use new data, not migrate
      expect(result).toEqual(['new-crawl-1']);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle missing legacy file gracefully', async () => {
      // Mock no files exist
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));

      const result = await getRecentJobIds('crawl');

      // Should return empty array, no errors
      expect(result).toEqual([]);
    });
  });

  describe('Directory Independence', () => {
    it('should persist data across working directory changes', async () => {
      // Start in directory A
      mockCwd = '/project/dir-a';

      // Mock empty state
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await recordJob('crawl', 'job-from-dir-a');

      const firstWriteCall = vi.mocked(fs.writeFile).mock.calls[0];
      const firstWritePath = firstWriteCall[0] as string;

      // Change to directory B
      mockCwd = '/completely/different/path';

      // Mock file now exists with data from dir A
      vi.mocked(fs.access).mockImplementation(async (path) => {
        if (path === expectedHistoryPath) return;
        throw new Error('not found');
      });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          crawl: [
            { id: 'job-from-dir-a', updatedAt: '2024-01-01T00:00:00.000Z' },
          ],
          batch: [],
          extract: [],
        })
      );

      const result = await getRecentJobIds('crawl');

      // Should find the job recorded from dir A
      expect(result).toContain('job-from-dir-a');

      // Verify paths are the same (using home directory, not cwd)
      const secondWritePath = firstWritePath;
      expect(secondWritePath).toBe(expectedHistoryPath);
      expect(secondWritePath).not.toContain('/project/dir-a');
      expect(secondWritePath).not.toContain('/completely/different/path');
    });
  });

  describe('recordJob', () => {
    beforeEach(() => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    });

    it('should record new job', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ crawl: [], batch: [], extract: [] })
      );

      await recordJob('crawl', 'new-job-123');

      expect(fs.writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const data = JSON.parse(writeCall[1] as string);

      expect(data.crawl).toHaveLength(1);
      expect(data.crawl[0].id).toBe('new-job-123');
      expect(data.crawl[0].updatedAt).toBeDefined();
    });

    it('should update existing job to top of list', async () => {
      const existingData = {
        crawl: [
          { id: 'job-1', updatedAt: '2024-01-01T00:00:00.000Z' },
          { id: 'job-2', updatedAt: '2024-01-02T00:00:00.000Z' },
          { id: 'job-3', updatedAt: '2024-01-03T00:00:00.000Z' },
        ],
        batch: [],
        extract: [],
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingData));

      await recordJob('crawl', 'job-2');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const data = JSON.parse(writeCall[1] as string);

      expect(data.crawl).toHaveLength(3);
      expect(data.crawl[0].id).toBe('job-2'); // Moved to top
      expect(data.crawl[1].id).toBe('job-1');
      expect(data.crawl[2].id).toBe('job-3');
    });

    it('should limit entries to MAX_ENTRIES (20)', async () => {
      const existingData = {
        crawl: Array.from({ length: 20 }, (_, i) => ({
          id: `job-${i}`,
          updatedAt: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        })),
        batch: [],
        extract: [],
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingData));

      await recordJob('crawl', 'new-job');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const data = JSON.parse(writeCall[1] as string);

      expect(data.crawl).toHaveLength(20); // Still 20, oldest dropped
      expect(data.crawl[0].id).toBe('new-job'); // New job at top
      expect(data.crawl[19].id).toBe('job-18'); // Last one is job-18 (job-19 was dropped)
    });

    it('should handle empty job id gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ crawl: [], batch: [], extract: [] })
      );

      await recordJob('crawl', '');

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle each job type independently', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ crawl: [], batch: [], extract: [] })
      );

      await recordJob('crawl', 'crawl-job');
      await recordJob('batch', 'batch-job');
      await recordJob('extract', 'extract-job');

      expect(fs.writeFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('getRecentJobIds', () => {
    beforeEach(() => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
    });

    it('should return recent job IDs', async () => {
      const data = {
        crawl: [
          { id: 'job-1', updatedAt: '2024-01-01T00:00:00.000Z' },
          { id: 'job-2', updatedAt: '2024-01-02T00:00:00.000Z' },
          { id: 'job-3', updatedAt: '2024-01-03T00:00:00.000Z' },
        ],
        batch: [],
        extract: [],
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(data));

      const result = await getRecentJobIds('crawl');

      expect(result).toEqual(['job-1', 'job-2', 'job-3']);
    });

    it('should respect limit parameter', async () => {
      const data = {
        crawl: [
          { id: 'job-1', updatedAt: '2024-01-01T00:00:00.000Z' },
          { id: 'job-2', updatedAt: '2024-01-02T00:00:00.000Z' },
          { id: 'job-3', updatedAt: '2024-01-03T00:00:00.000Z' },
        ],
        batch: [],
        extract: [],
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(data));

      const result = await getRecentJobIds('crawl', 2);

      expect(result).toEqual(['job-1', 'job-2']);
    });

    it('should return empty array for missing history', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));

      const result = await getRecentJobIds('crawl');

      expect(result).toEqual([]);
    });
  });

  describe('removeJobIds', () => {
    beforeEach(() => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    });

    it('should remove specified job IDs', async () => {
      const data = {
        crawl: [
          { id: 'job-1', updatedAt: '2024-01-01T00:00:00.000Z' },
          { id: 'job-2', updatedAt: '2024-01-02T00:00:00.000Z' },
          { id: 'job-3', updatedAt: '2024-01-03T00:00:00.000Z' },
        ],
        batch: [],
        extract: [],
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(data));

      await removeJobIds('crawl', ['job-2']);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const result = JSON.parse(writeCall[1] as string);

      expect(result.crawl).toHaveLength(2);
      expect(result.crawl.map((e: { id: string }) => e.id)).toEqual([
        'job-1',
        'job-3',
      ]);
    });

    it('should handle empty ID array gracefully', async () => {
      const data = {
        crawl: [{ id: 'job-1', updatedAt: '2024-01-01T00:00:00.000Z' }],
        batch: [],
        extract: [],
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(data));

      await removeJobIds('crawl', []);

      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('clearJobHistory', () => {
    beforeEach(() => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    });

    it('should clear all job history', async () => {
      await clearJobHistory();

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const data = JSON.parse(writeCall[1] as string);

      expect(data).toEqual({ crawl: [], batch: [], extract: [] });
    });
  });
});
