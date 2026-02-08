/**
 * Tests for embedder webhook helpers
 */

import { describe, expect, it } from 'vitest';
import {
  extractEmbedderWebhookJobInfo,
  getEmbedderWebhookSettings,
} from '../../utils/embedder-webhook';

describe('extractEmbedderWebhookJobInfo', () => {
  it('should extract job info from root payload', () => {
    const info = extractEmbedderWebhookJobInfo({
      id: 'job-1',
      status: 'completed',
      data: [{ markdown: '# Title' }],
    });

    expect(info).toEqual({
      jobId: 'job-1',
      status: 'completed',
      pages: [{ markdown: '# Title' }],
    });
  });

  it('should extract job info from nested payload and event', () => {
    const info = extractEmbedderWebhookJobInfo({
      event: 'crawl.completed',
      data: {
        id: 'job-2',
        data: [{ html: '<h1>Hi</h1>' }],
      },
    });

    expect(info).toEqual({
      jobId: 'job-2',
      status: 'completed',
      pages: [{ html: '<h1>Hi</h1>' }],
    });
  });

  it('should extract job info from jobId and failed event', () => {
    const info = extractEmbedderWebhookJobInfo({
      jobId: 'job-3',
      type: 'crawl.failed',
    });

    expect(info).toEqual({
      jobId: 'job-3',
      status: 'failed',
      pages: undefined,
    });
  });

  it('should return null for invalid payload', () => {
    expect(extractEmbedderWebhookJobInfo('invalid')).toBeNull();
  });
});

describe('getEmbedderWebhookSettings', () => {
  it('should return defaults when no config set', () => {
    const settings = getEmbedderWebhookSettings();
    expect(settings.port).toBe(53000);
    expect(settings.path).toBe('/webhooks/crawl');
    expect(settings.url).toBeUndefined();
  });
});
