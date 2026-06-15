// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArtifactRow, CommandResultCard } from './panel-components';
import type { ArtifactHandle, CommandResultView } from './panel-types';

const artifact: ArtifactHandle = {
  relative_path: 'screenshots/shot.png',
  bytes: 32,
  kind: 'screenshot',
  display_path: 'screenshots/shot.png'
};

function commandResult(overrides: Partial<CommandResultView> = {}): CommandResultView {
  return {
    ok: true,
    title: 'Screenshot captured',
    subtitle: 'screenshots/shot.png',
    rows: [],
    imageUrl: '/api/panel/artifact/screenshots/shot.png',
    imageArtifact: artifact,
    artifacts: [artifact],
    ...overrides
  };
}

describe('panel artifact rendering', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:artifact');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the artifact row visible while loading the authenticated preview', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Blob(['png'], { type: 'image/png' }), {
        headers: { 'content-type': 'image/png', 'content-length': '3' }
      })
    );

    await act(async () => {
      root.render(<CommandResultCard result={commandResult()} panelToken="panel-token" />);
    });

    expect(fetch).toHaveBeenCalledWith('/api/panel/artifact/screenshots/shot.png', {
      headers: { 'x-axon-panel-token': 'panel-token' }
    });
    expect(host.querySelector('.artifact-name')?.textContent).toBe('shot.png');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:artifact');
  });

  it('shows preview errors when the server returns non-raster content', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Blob(['{}'], { type: 'application/json' }), {
        headers: { 'content-type': 'application/json', 'content-length': '2' }
      })
    );

    await act(async () => {
      root.render(<CommandResultCard result={commandResult()} panelToken="panel-token" />);
    });

    expect(host.textContent).toContain('Preview unavailable: artifact is application/json, not a previewable image');
    expect(host.querySelector('.artifact-name')?.textContent).toBe('shot.png');
  });

  it('shows artifact row errors when download/open fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('missing', { status: 404 }));

    await act(async () => {
      root.render(<ArtifactRow artifact={artifact} panelToken="panel-token" />);
    });

    const button = host.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.textContent).toContain('Could not open shot.png: artifact fetch failed with 404');
  });
});
