/**
 * Legacy Qdrant utility wrappers.
 *
 * This module now delegates to the container-oriented QdrantService to avoid
 * duplicated request logic across the codebase.
 */

import { HttpClient } from '../container/services/HttpClient';
import { QdrantService } from '../container/services/QdrantService';

const serviceCache = new Map<string, QdrantService>();

function getService(qdrantUrl: string): QdrantService {
  const cached = serviceCache.get(qdrantUrl);
  if (cached) {
    return cached;
  }

  const service = new QdrantService(qdrantUrl, new HttpClient());
  serviceCache.set(qdrantUrl, service);
  return service;
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface QueryOptions {
  limit: number;
  domain?: string;
}

export interface QueryResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface ScrollResult {
  id: string;
  payload: Record<string, unknown>;
}

export async function ensureCollection(
  qdrantUrl: string,
  collection: string,
  dimension: number
): Promise<void> {
  await getService(qdrantUrl).ensureCollection(collection, dimension);
}

export async function upsertPoints(
  qdrantUrl: string,
  collection: string,
  points: QdrantPoint[]
): Promise<void> {
  await getService(qdrantUrl).upsertPoints(collection, points);
}

export async function deleteByUrl(
  qdrantUrl: string,
  collection: string,
  url: string
): Promise<void> {
  await getService(qdrantUrl).deleteByUrl(collection, url);
}

export async function queryPoints(
  qdrantUrl: string,
  collection: string,
  vector: number[],
  options: QueryOptions
): Promise<QueryResult[]> {
  const filter = options.domain ? { domain: options.domain } : undefined;
  const points = await getService(qdrantUrl).queryPoints(
    collection,
    vector,
    options.limit,
    filter
  );

  return points.map((point) => ({
    id: point.id,
    score: point.score ?? 0,
    payload: point.payload,
  }));
}

export async function scrollByUrl(
  qdrantUrl: string,
  collection: string,
  url: string
): Promise<ScrollResult[]> {
  const points = await getService(qdrantUrl).scrollByUrl(collection, url);
  return points.map((point) => ({ id: point.id, payload: point.payload }));
}

export async function deleteByDomain(
  qdrantUrl: string,
  collection: string,
  domain: string
): Promise<void> {
  await getService(qdrantUrl).deleteByDomain(collection, domain);
}

export async function countByDomain(
  qdrantUrl: string,
  collection: string,
  domain: string
): Promise<number> {
  return getService(qdrantUrl).countByDomain(collection, domain);
}

/**
 * Reset module-level service cache for tests.
 */
export function resetQdrantCache(): void {
  serviceCache.clear();
}
