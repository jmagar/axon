/**
 * Tests for output utilities
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleScrapeOutput,
  validateOutputPath,
  writeOutput,
} from '../../utils/output';

// Mock fs module (use node: prefix to match production imports)
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  realpathSync: vi.fn((p: string) => p), // Mock realpathSync to return the input path
}));

// Mock fs/promises module for async I/O (must match 'node:fs/promises' import specifier)
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Helper to get resolved path
const resolvePath = (p: string) => path.resolve(process.cwd(), p);
describe('Output Utilities', () => {
  let consoleErrorSpy: MockInstance;
  let processExitSpy: MockInstance;
  let stdoutWriteSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeOutput', () => {
    it('should write content to stdout when no output path is provided', async () => {
      await writeOutput('Test content');

      expect(stdoutWriteSpy).toHaveBeenCalledWith('Test content\n');
    });

    it('should add newline to content if not present', async () => {
      await writeOutput('Test content without newline');

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        'Test content without newline\n'
      );
    });

    it('should not add extra newline if content already ends with newline', async () => {
      await writeOutput('Test content with newline\n');

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        'Test content with newline\n'
      );
    });

    it('should write content to file when output path is provided', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await writeOutput('Test content', './output/test.txt');

      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        resolvePath('./output/test.txt'),
        'Test content',
        'utf-8'
      );
    });

    it('should create directory if it does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await writeOutput('Test content', './output/subdir/test.txt');

      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        resolvePath('./output/subdir'),
        {
          recursive: true,
        }
      );
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        resolvePath('./output/subdir/test.txt'),
        'Test content',
        'utf-8'
      );
    });

    it('should print file confirmation when not silent', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await writeOutput('Test content', './output/test.txt', false);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(resolvePath('./output/test.txt'))
      );
    });

    it('should not print file confirmation when silent', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await writeOutput('Test content', './output/test.txt', true);

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('handleScrapeOutput', () => {
    it('should output error and set exit code when result is not successful', async () => {
      await handleScrapeOutput({ success: false, error: 'API Error' }, [
        'markdown',
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('API Error')
      );
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    });

    it('should output raw markdown for single markdown format', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: { markdown: '# Test Content\n\nParagraph here.' },
        },
        ['markdown']
      );

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        '# Test Content\n\nParagraph here.\n'
      );
    });

    it('should output raw HTML for single html format', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: { html: '<html><body>Test</body></html>' },
        },
        ['html']
      );

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        '<html><body>Test</body></html>\n'
      );
    });

    it('should output raw HTML for single rawHtml format', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: { rawHtml: '<!DOCTYPE html><html><body>Raw</body></html>' },
        },
        ['rawHtml']
      );

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        '<!DOCTYPE html><html><body>Raw</body></html>\n'
      );
    });

    it('should output newline-separated links for single links format', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: {
            links: [
              'https://example.com/1',
              'https://example.com/2',
              'https://example.com/3',
            ],
          },
        },
        ['links']
      );

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        'https://example.com/1\nhttps://example.com/2\nhttps://example.com/3\n'
      );
    });

    it('should output newline-separated images for single images format', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: {
            images: [
              'https://example.com/img1.jpg',
              'https://example.com/img2.png',
            ],
          },
        },
        ['images']
      );

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        'https://example.com/img1.jpg\nhttps://example.com/img2.png\n'
      );
    });

    it('should output summary for single summary format', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: { summary: 'This is a summary of the page content.' },
        },
        ['summary']
      );

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        'This is a summary of the page content.\n'
      );
    });

    it('should render style header for readable single-format stdout output', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: { markdown: '# Test Content' },
        },
        ['markdown'],
        undefined,
        false,
        false,
        {
          title: 'Scrape Results for https://example.com',
          summary: ['Requested formats: 1', 'returned: 1'],
          filters: { onlyMainContent: true },
          includeFreshness: true,
        }
      );

      const output = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(output).toContain('Scrape Results for https://example.com');
      expect(output).toContain('Requested formats: 1 | returned: 1');
      expect(output).toContain('Filters: onlyMainContent=true');
      expect(output).toContain('As of (ET):');
      expect(output).toContain('# Test Content');
    });

    it('should output formatted screenshot info for single screenshot format', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: {
            screenshot: 'https://example.com/screenshot.png',
            metadata: {
              title: 'Test Page',
              sourceURL: 'https://example.com',
              description: 'A test page',
            },
          },
        },
        ['screenshot']
      );

      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Screenshot: https://example.com/screenshot.png'
        )
      );
    });

    it('should output JSON for multiple formats', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: {
            markdown: '# Test',
            links: ['https://example.com'],
            metadata: { title: 'Test' },
          },
        },
        ['markdown', 'links']
      );

      const output = stdoutWriteSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.markdown).toBe('# Test');
      expect(parsed.links).toEqual(['https://example.com']);
    });

    it('should output pretty JSON when pretty flag is true', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: {
            markdown: '# Test',
            links: ['https://example.com'],
          },
        },
        ['markdown', 'links'],
        undefined,
        true
      );

      const output = stdoutWriteSpy.mock.calls[0][0];
      expect(output).toContain('\n'); // Pretty print has newlines
    });

    it('should write to file when output path is provided', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: { markdown: '# Test Content' },
        },
        ['markdown'],
        './output/test.md'
      );

      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        resolvePath('./output/test.md'),
        '# Test Content',
        'utf-8'
      );
    });

    it('should handle missing data gracefully', async () => {
      await handleScrapeOutput(
        {
          success: true,
          data: undefined,
        },
        ['markdown']
      );

      // Should not throw, just return early
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    it('should fallback to rawHtml when html requested but only rawHtml available', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: { rawHtml: '<html>Content</html>' },
        },
        ['html']
      );

      expect(stdoutWriteSpy).toHaveBeenCalledWith('<html>Content</html>\n');
    });

    it('should include metadata in JSON output when present', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: {
            markdown: '# Test',
            links: [],
            metadata: {
              title: 'Test Page',
              description: 'A test',
              sourceURL: 'https://example.com',
            },
          },
        },
        ['markdown', 'links']
      );

      const output = stdoutWriteSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.title).toBe('Test Page');
    });

    it('should output JSON when --json flag is true even for single text format', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: { markdown: '# Test Content' },
        },
        ['markdown'],
        undefined,
        false,
        true // json flag
      );

      const output = stdoutWriteSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.markdown).toBe('# Test Content');
    });

    it('should output JSON when --json flag is true for screenshot format', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: {
            screenshot: 'https://example.com/screenshot.png',
            metadata: {
              title: 'Test Page',
              sourceURL: 'https://example.com',
            },
          },
        },
        ['screenshot'],
        undefined,
        false,
        true // json flag
      );

      const output = stdoutWriteSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.screenshot).toBe('https://example.com/screenshot.png');
      expect(parsed.metadata.title).toBe('Test Page');
    });

    it('should infer JSON output when output file has .json extension', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: {
            screenshot: 'https://example.com/screenshot.png',
            metadata: {
              title: 'Test Page',
            },
          },
        },
        ['screenshot'],
        './output/result.json', // .json extension
        false,
        false // no explicit json flag
      );

      // Should write JSON to file
      expect(fsPromises.writeFile).toHaveBeenCalled();
      const content = vi.mocked(fsPromises.writeFile).mock.calls[0][1];
      const parsed = JSON.parse(
        typeof content === 'string' ? content : content.toString()
      );
      expect(parsed.screenshot).toBe('https://example.com/screenshot.png');
    });

    it('should NOT infer JSON for non-.json extensions', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: {
            screenshot: 'https://example.com/screenshot.png',
            metadata: {
              title: 'Test Page',
              sourceURL: 'https://example.com',
            },
          },
        },
        ['screenshot'],
        './output/result.md', // .md extension
        false,
        false // no explicit json flag
      );

      // Should write formatted text, not JSON
      expect(fsPromises.writeFile).toHaveBeenCalled();
      const content = vi.mocked(fsPromises.writeFile).mock.calls[0][1];
      const text = typeof content === 'string' ? content : content.toString();
      expect(text).toContain('Screenshot: https://example.com/screenshot.png');
      expect(() => JSON.parse(text)).toThrow(); // Not valid JSON
    });

    it('should output pretty JSON when both json and pretty flags are true', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await handleScrapeOutput(
        {
          success: true,
          data: { markdown: '# Test' },
        },
        ['markdown'],
        undefined,
        true, // pretty flag
        true // json flag
      );

      const output = stdoutWriteSpy.mock.calls[0][0];
      expect(output).toContain('\n'); // Pretty print has newlines
      const parsed = JSON.parse(output);
      expect(parsed.markdown).toBe('# Test');
    });
  });

  describe('validateOutputPath', () => {
    it('should allow relative paths within cwd', () => {
      expect(() => validateOutputPath('./output/result.json')).not.toThrow();
      expect(() => validateOutputPath('output/result.json')).not.toThrow();
      expect(() => validateOutputPath('result.json')).not.toThrow();
    });

    it('should reject path traversal attempts', () => {
      expect(() => validateOutputPath('../../../etc/passwd')).toThrow(
        /resolves outside allowed directory/
      );
      expect(() => validateOutputPath('output/../../etc/passwd')).toThrow(
        /resolves outside allowed directory/
      );
    });

    it('should reject absolute paths outside cwd', () => {
      expect(() => validateOutputPath('/etc/passwd')).toThrow(
        /resolves outside allowed directory/
      );
      expect(() => validateOutputPath('/tmp/output.json')).toThrow(
        /resolves outside allowed directory/
      );
    });

    it('should allow absolute paths within cwd', () => {
      const validPath = path.join(process.cwd(), 'output', 'result.json');
      expect(() => validateOutputPath(validPath)).not.toThrow();
    });

    it('should return resolved absolute path', () => {
      const result = validateOutputPath('./output/result.json');
      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toBe(resolvePath('./output/result.json'));
    });
  });
});
