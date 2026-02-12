import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContainer } from '../../container/ContainerFactory';

describe('ContainerFactory', () => {
  beforeEach(() => {
    // Clear environment variables
    delete process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT;
    vi.clearAllMocks();
  });

  describe('embedderWebhookPort validation', () => {
    it('should accept valid port from options', () => {
      const container = createContainer({
        embedderWebhookPort: 53000,
      });

      expect(container.config.embedderWebhookPort).toBe(53000);
    });

    it('should accept valid port from environment variable', () => {
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT = '53001';

      const container = createContainer();

      expect(container.config.embedderWebhookPort).toBe(53001);
    });

    it('should reject port < 1 from options', () => {
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const container = createContainer({
        embedderWebhookPort: 0,
      });

      expect(container.config.embedderWebhookPort).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid embedderWebhookPort option: 0')
      );

      warnSpy.mockRestore();
    });

    it('should reject port >= 65536 from options', () => {
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const container = createContainer({
        embedderWebhookPort: 65536,
      });

      expect(container.config.embedderWebhookPort).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid embedderWebhookPort option: 65536')
      );

      warnSpy.mockRestore();
    });

    it('should reject negative port from options', () => {
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const container = createContainer({
        embedderWebhookPort: -1,
      });

      expect(container.config.embedderWebhookPort).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid embedderWebhookPort option: -1')
      );

      warnSpy.mockRestore();
    });

    it('should reject non-finite port from options', () => {
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const container = createContainer({
        embedderWebhookPort: Number.NaN,
      });

      expect(container.config.embedderWebhookPort).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid embedderWebhookPort option: NaN')
      );

      warnSpy.mockRestore();
    });

    it('should reject invalid port from environment variable', () => {
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT = '0';

      const container = createContainer();

      expect(container.config.embedderWebhookPort).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid FIRECRAWL_EMBEDDER_WEBHOOK_PORT: 0')
      );

      warnSpy.mockRestore();
    });

    it('should reject non-numeric port from environment variable', () => {
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT = 'invalid';

      const container = createContainer();

      expect(container.config.embedderWebhookPort).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Invalid FIRECRAWL_EMBEDDER_WEBHOOK_PORT: invalid'
        )
      );

      warnSpy.mockRestore();
    });

    it('should prefer options over environment variable', () => {
      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT = '53001';

      const container = createContainer({
        embedderWebhookPort: 53002,
      });

      expect(container.config.embedderWebhookPort).toBe(53002);
    });

    it('should use environment variable when options are invalid', () => {
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      process.env.FIRECRAWL_EMBEDDER_WEBHOOK_PORT = '53001';

      const container = createContainer({
        embedderWebhookPort: -1,
      });

      expect(container.config.embedderWebhookPort).toBe(53001);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid embedderWebhookPort option: -1')
      );

      warnSpy.mockRestore();
    });

    it('should handle edge case port 1', () => {
      const container = createContainer({
        embedderWebhookPort: 1,
      });

      expect(container.config.embedderWebhookPort).toBe(1);
    });

    it('should handle edge case port 65535', () => {
      const container = createContainer({
        embedderWebhookPort: 65535,
      });

      expect(container.config.embedderWebhookPort).toBe(65535);
    });
  });
});
