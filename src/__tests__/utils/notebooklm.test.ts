/**
 * Tests for NotebookLM integration wrapper
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addUrlsToNotebook } from '../../utils/notebooklm';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('addUrlsToNotebook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return result on successful execution', async () => {
    const mockStdout = JSON.stringify({
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 2,
      failed: 0,
      errors: [],
    });

    const mockProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
      },
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from(mockStdout));
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(0);
        }
      }),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(mockProcess);

    const result = await addUrlsToNotebook('Test Notebook', [
      'https://example.com',
      'https://test.com',
    ]);

    expect(result).toEqual({
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 2,
      failed: 0,
      errors: [],
    });

    expect(spawn).toHaveBeenCalledWith(
      'python3',
      ['scripts/notebooklm_add_urls.py'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );

    expect(mockProcess.stdin?.write).toHaveBeenCalledWith(
      JSON.stringify({
        notebook: 'Test Notebook',
        urls: ['https://example.com', 'https://test.com'],
      })
    );
    expect(mockProcess.stdin?.end).toHaveBeenCalled();
  });

  it('should return null when python3 is not found', async () => {
    const mockProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
      },
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event, callback) => {
        if (event === 'error') {
          callback(new Error('spawn python3 ENOENT'));
        }
      }),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(mockProcess);

    const result = await addUrlsToNotebook('Test', ['https://example.com']);

    expect(result).toBeNull();
  }, 3000);

  it('should return null when script exits with non-zero code', async () => {
    const mockProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
      },
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('notebooklm not installed'));
          }
        }),
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(1);
        }
      }),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(mockProcess);

    const result = await addUrlsToNotebook('Test', ['https://example.com']);

    expect(result).toBeNull();
  });

  it('should return null when script outputs invalid JSON', async () => {
    const mockProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
      },
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('not valid json'));
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(0);
        }
      }),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(mockProcess);

    const result = await addUrlsToNotebook('Test', ['https://example.com']);

    expect(result).toBeNull();
  });

  it('should return partial result when some URLs fail', async () => {
    const mockStdout = JSON.stringify({
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 2,
      failed: 1,
      errors: ['https://bad.com: Rate limit exceeded'],
    });

    const mockProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
      },
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from(mockStdout));
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(0);
        }
      }),
    } as unknown as ChildProcess;

    vi.mocked(spawn).mockReturnValue(mockProcess);

    const result = await addUrlsToNotebook('Test', [
      'https://example.com',
      'https://test.com',
      'https://bad.com',
    ]);

    expect(result).toEqual({
      notebook_id: 'abc123',
      notebook_title: 'Test Notebook',
      added: 2,
      failed: 1,
      errors: ['https://bad.com: Rate limit exceeded'],
    });
  });
});
