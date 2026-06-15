import { describe, expect, it } from 'vitest';
import { formatCommandResponse, panelArtifactUrl } from './command-format';

describe('artifact preview URLs', () => {
  it('segment-encodes panel artifact paths', () => {
    expect(panelArtifactUrl('screenshots/foo #1.png')).toBe(
      '/api/panel/artifact/screenshots/foo%20%231.png'
    );
    expect(panelArtifactUrl('markdown/a%2Fb.md')).toBe('/api/panel/artifact/markdown/a%252Fb.md');
  });

  it('uses the panel artifact route for screenshot images', () => {
    const view = formatCommandResponse({
      command: 'screenshot https://example.com',
      action: { action: 'screenshot' },
      result: {
        url: 'https://example.com',
        path: '/home/axon/.axon/output/screenshots/example.png',
        size_bytes: 1024,
        artifact_handle: {
          relative_path: 'screenshots/example.png',
          display_path: 'screenshots/example.png',
          kind: 'screenshot',
          bytes: 1024
        }
      }
    });

    expect(view.imageUrl).toBe('/api/panel/artifact/screenshots/example.png');
    expect(view.raw).toBeUndefined();
  });

  it('does not create an image for non-image artifacts', () => {
    const view = formatCommandResponse({
      command: 'crawl https://example.com',
      action: { action: 'crawl' },
      result: {
        predicted_artifact_handles: [
          {
            relative_path: 'markdown/example.md',
            display_path: 'markdown/example.md',
            kind: 'markdown',
            bytes: 64
          }
        ]
      }
    });

    expect(view.imageUrl).toBeUndefined();
    expect(view.artifacts?.[0].relative_path).toBe('markdown/example.md');
  });
});
