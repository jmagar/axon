import { describe, expect, it } from 'vitest';
import { chunkText } from '../../utils/chunker';

describe('chunkText', () => {
  describe('edge cases', () => {
    it('should return empty array for empty string', () => {
      expect(chunkText('')).toEqual([]);
    });

    it('should return empty array for whitespace-only string', () => {
      expect(chunkText('   \n\n  ')).toEqual([]);
    });

    it('should return single chunk for short text', () => {
      const chunks = chunkText('Hello world');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe('Hello world');
      expect(chunks[0].index).toBe(0);
      expect(chunks[0].header).toBeNull();
    });
  });

  describe('markdown header splitting', () => {
    it('should split on markdown headers', () => {
      const input =
        '# Title\n\nIntro text.\n\n## Section 1\n\nContent one.\n\n## Section 2\n\nContent two.';
      const chunks = chunkText(input);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks[0].header).toBe('Title');
      expect(chunks[1].header).toBe('Section 1');
      expect(chunks[2].header).toBe('Section 2');
    });

    it('should handle nested headers', () => {
      const input =
        '# Main\n\nIntro.\n\n## Sub\n\nDetails.\n\n### Deep\n\nMore.';
      const chunks = chunkText(input);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('paragraph splitting', () => {
    it('should split on double newlines when no headers', () => {
      const input =
        'Paragraph one content here.\n\nParagraph two content here.\n\nParagraph three content here.';
      const chunks = chunkText(input);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // All should have null header
      for (const chunk of chunks) {
        expect(chunk.header).toBeNull();
      }
    });
  });

  describe('fixed-size splitting', () => {
    it('should split large text without headers or paragraphs into fixed-size chunks', () => {
      // Generate a long single paragraph (3000 chars, no double newlines)
      const longText = 'A'.repeat(3000);
      const chunks = chunkText(longText);

      expect(chunks.length).toBeGreaterThan(1);
      // Each chunk should be <= 1500 chars
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(1500);
      }
    });

    it('should include overlap between fixed-size chunks', () => {
      const longText = Array.from({ length: 300 }, (_, i) => `word${i}`).join(
        ' '
      );
      const chunks = chunkText(longText);

      if (chunks.length > 1) {
        // Last part of chunk N should appear in chunk N+1 (overlap)
        const overlap = chunks[0].text.slice(-50);
        expect(chunks[1].text.includes(overlap)).toBe(true);
      }
    });
  });

  describe('small chunk merging', () => {
    it('should merge chunks smaller than 50 characters into previous', () => {
      // Section with a very short chunk
      const input =
        '# Title\n\nOk.\n\n## Section\n\nThis is a normal length paragraph with real content.';
      const chunks = chunkText(input);

      // No chunk should be less than 50 chars unless it's the only one
      for (const chunk of chunks) {
        if (chunks.length > 1) {
          // Allow the last chunk to be short
          if (chunk.index < chunks.length - 1) {
            expect(chunk.text.length).toBeGreaterThanOrEqual(50);
          }
        }
      }
    });
  });

  describe('chunk indexing', () => {
    it('should assign sequential indices starting from 0', () => {
      const input = '# A\n\nFirst.\n\n## B\n\nSecond.\n\n## C\n\nThird.';
      const chunks = chunkText(input);

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].index).toBe(i);
      }
    });
  });
});
