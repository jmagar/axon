/**
 * Map command implementation
 */

import type { MapOptions, MapResult } from '../types/map';
import { getClient } from '../utils/client';
import { addUrlsToNotebook } from '../utils/notebooklm';
import { writeOutput } from '../utils/output';

/**
 * Execute map command
 */
export async function executeMap(options: MapOptions): Promise<MapResult> {
  try {
    const app = getClient({ apiKey: options.apiKey });
    const { urlOrJobId } = options;

    // Build map options
    const mapOptions: any = {};

    if (options.limit !== undefined) {
      mapOptions.limit = options.limit;
    }
    if (options.search) {
      mapOptions.search = options.search;
    }
    if (options.sitemap) {
      mapOptions.sitemap = options.sitemap;
    }
    if (options.includeSubdomains !== undefined) {
      mapOptions.includeSubdomains = options.includeSubdomains;
    }
    if (options.ignoreQueryParameters !== undefined) {
      mapOptions.ignoreQueryParameters = options.ignoreQueryParameters;
    }
    if (options.timeout !== undefined) {
      mapOptions.timeout = options.timeout * 1000; // Convert to milliseconds
    }

    // Execute map (seems synchronous in SDK)
    const mapData = await app.map(urlOrJobId, mapOptions);

    return {
      success: true,
      data: {
        links: mapData.links.map((link: any) => ({
          url: link.url,
          title: link.title,
          description: link.description,
        })),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Format map data in human-readable way
 */
function formatMapReadable(data: MapResult['data']): string {
  if (!data || !data.links) return '';

  // Output one URL per line (like curl)
  return data.links.map((link) => link.url).join('\n') + '\n';
}

/**
 * Handle map command output and optional NotebookLM integration
 */
export async function handleMapCommand(options: MapOptions): Promise<void> {
  const result = await executeMap(options);

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  if (!result.data) {
    return;
  }

  // Optional: Add URLs to NotebookLM notebook
  if (options.notebook && result.data.links.length > 0) {
    const urls = result.data.links.map((link) => link.url);

    // Truncate to 300 URLs (NotebookLM Pro limit)
    if (urls.length > 300) {
      console.error(
        `[NotebookLM] Warning: Truncating to 300 URLs (NotebookLM limit), found ${urls.length}`
      );
    }

    const urlsToAdd = urls.slice(0, 300);

    console.error(
      `[NotebookLM] Adding ${urlsToAdd.length} URLs to notebook "${options.notebook}"...`
    );

    const notebookResult = await addUrlsToNotebook(options.notebook, urlsToAdd);

    if (notebookResult) {
      if (notebookResult.failed === 0) {
        console.error(
          `[NotebookLM] Added ${notebookResult.added}/${urlsToAdd.length} URLs as sources`
        );
      } else {
        console.error(
          `[NotebookLM] Added ${notebookResult.added}/${urlsToAdd.length} URLs as sources (${notebookResult.failed} failed)`
        );
        notebookResult.errors.slice(0, 5).forEach((error) => {
          console.error(`[NotebookLM]   - ${error}`);
        });
        if (notebookResult.errors.length > 5) {
          console.error(
            `[NotebookLM]   ... and ${notebookResult.errors.length - 5} more errors`
          );
        }
      }
      console.error(`[NotebookLM] Notebook ID: ${notebookResult.notebook_id}`);
    } else {
      console.error(
        '[NotebookLM] Failed to add URLs. Check that python3 and notebooklm are installed.'
      );
    }
  }

  let outputContent: string;

  // Use JSON format if --json flag is set
  if (options.json) {
    outputContent = options.pretty
      ? JSON.stringify({ success: true, data: result.data }, null, 2)
      : JSON.stringify({ success: true, data: result.data });
  } else {
    // Default to human-readable format (one URL per line)
    outputContent = formatMapReadable(result.data);
  }

  writeOutput(outputContent, options.output, !!options.output);
}
