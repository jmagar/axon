/**
 * Helpers for embedder webhook configuration and payload parsing
 */

import type { Document, WebhookConfig } from '@mendable/firecrawl-js';
import type { ImmutableConfig } from '../container/types';

export const DEFAULT_EMBEDDER_WEBHOOK_PORT = 53000;
export const DEFAULT_EMBEDDER_WEBHOOK_PATH = '/webhooks/crawl';
export const EMBEDDER_WEBHOOK_HEADER = 'x-firecrawl-embedder-secret';

export interface EmbedderWebhookSettings {
  url?: string;
  port: number;
  path: string;
  secret?: string;
}

export interface EmbedderWebhookJobInfo {
  jobId: string;
  status?: string;
  pages?: Document[];
}

function normalizePath(path: string | undefined): string {
  if (!path) return DEFAULT_EMBEDDER_WEBHOOK_PATH;
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizePort(port: number | undefined): number {
  if (typeof port !== 'number' || Number.isNaN(port)) {
    return DEFAULT_EMBEDDER_WEBHOOK_PORT;
  }
  const normalized = Math.trunc(port);
  // Only reject privileged ports (< 1024) and invalid ports
  if (normalized < 1024 || normalized > 65535) {
    return DEFAULT_EMBEDDER_WEBHOOK_PORT;
  }
  return normalized;
}

export function getEmbedderWebhookSettings(
  config: Partial<ImmutableConfig> = {}
): EmbedderWebhookSettings {
  return {
    url: config.embedderWebhookUrl,
    port: normalizePort(config.embedderWebhookPort),
    path: normalizePath(config.embedderWebhookPath),
    secret: config.embedderWebhookSecret,
  };
}

export function buildEmbedderWebhookConfig(
  config?: ImmutableConfig
): WebhookConfig | null {
  const settings = getEmbedderWebhookSettings(config);
  if (!settings.url) {
    return null;
  }

  const headers: Record<string, string> | undefined = settings.secret
    ? { [EMBEDDER_WEBHOOK_HEADER]: settings.secret }
    : undefined;

  return {
    url: settings.url,
    headers,
    events: ['completed', 'failed'],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function inferStatus(status: string | undefined, event: string | undefined) {
  if (status) {
    return status;
  }

  if (!event) {
    return undefined;
  }

  const normalized = event.toLowerCase();
  if (normalized.includes('completed')) {
    return 'completed';
  }
  if (normalized.includes('failed')) {
    return 'failed';
  }
  if (normalized.includes('cancel')) {
    return 'cancelled';
  }
  if (normalized.includes('started')) {
    return 'started';
  }
  if (normalized.includes('page')) {
    return 'page';
  }

  return undefined;
}

export function extractEmbedderWebhookJobInfo(
  payload: unknown
): EmbedderWebhookJobInfo | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const rootData = asRecord(root.data);
  const rootCrawl = asRecord(root.crawl);

  const jobId =
    asString(root.jobId) ||
    asString(root.id) ||
    asString(rootData?.jobId) ||
    asString(rootData?.id) ||
    asString(rootCrawl?.jobId) ||
    asString(rootCrawl?.id);

  if (!jobId) {
    return null;
  }

  const status = inferStatus(
    asString(root.status) ||
      asString(rootData?.status) ||
      asString(rootCrawl?.status),
    asString(root.event) || asString(root.type) || asString(rootData?.event)
  );

  const pages =
    (Array.isArray(root.data) ? root.data : undefined) ||
    (Array.isArray(rootData?.data) ? rootData?.data : undefined) ||
    (Array.isArray(rootCrawl?.data) ? rootCrawl?.data : undefined) ||
    (Array.isArray((rootCrawl?.data as { data?: unknown })?.data)
      ? (rootCrawl?.data as { data?: unknown }).data
      : undefined);

  return {
    jobId,
    status,
    pages: pages as Document[] | undefined,
  };
}
