#!/usr/bin/env tsx
/**
 * Check Qdrant collection for duplicate chunks and data quality
 *
 * Usage:
 *   pnpm tsx scripts/check-qdrant-quality.ts                     # Check default collection
 *   pnpm tsx scripts/check-qdrant-quality.ts --health            # Show health info only
 *   pnpm tsx scripts/check-qdrant-quality.ts --collection name   # Check specific collection
 *   pnpm tsx scripts/check-qdrant-quality.ts --all               # Check all collections
 *   pnpm tsx scripts/check-qdrant-quality.ts --delete-duplicates # Delete duplicates
 *   pnpm tsx scripts/check-qdrant-quality.ts --delete-excluded   # Delete points matching exclude rules
 *   pnpm tsx scripts/check-qdrant-quality.ts --collection firecrawl --delete-duplicates
 */

import { config as loadDotenv } from 'dotenv';
import {
  mergeExcludeExtensions,
  mergeExcludePaths,
} from '../src/commands/crawl/options';
import { extensionsToPaths } from '../src/utils/extensions';
import { matchesPattern } from '../src/utils/url-filter';

loadDotenv();

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:53333';

/**
 * NOTE: These interfaces duplicate types from src/container/types.ts
 * This duplication is intentional - scripts should be standalone and not
 * depend on src/ to avoid circular dependencies and keep scripts portable.
 */
interface QdrantPoint {
  id: string;
  payload: {
    url?: string;
    chunk_text?: string;
    title?: string;
    chunk_index?: number;
    [key: string]: unknown;
  };
}

interface DuplicateGroup {
  url: string;
  count: number;
  ids: string[];
}

interface DataQualityIssues {
  missingUrl: number;
  missingContent: number;
  emptyContent: number;
  missingChunkIndex: number;
}

interface ExcludeViolationStats {
  matchedPoints: number;
  matchedUrls: number;
  matchedIds: string[];
  topUrls: Array<{ url: string; points: number; pattern: string }>;
}

interface CollectionInfo {
  name: string;
  points_count: number;
  vectors_count?: number;
  indexed_vectors_count?: number;
  segments_count?: number;
  status?: string;
  optimizer_status?: string;
  payload_schema?: Record<string, unknown>;
}

interface QdrantClusterInfo {
  version: string;
  commit?: string;
}

/**
 * Get Qdrant cluster info
 */
async function getClusterInfo(): Promise<QdrantClusterInfo> {
  const response = await fetch(`${QDRANT_URL}/`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Failed to get cluster info: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    version: data.version,
    commit: data.commit,
  };
}

/**
 * List all collections in Qdrant
 */
async function listCollections(): Promise<string[]> {
  const response = await fetch(`${QDRANT_URL}/collections`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Failed to list collections: ${response.statusText}`);
  }

  const data = await response.json();

  // Null-guard the result and collections array
  if (!data.result || !data.result.collections) {
    return [];
  }

  return data.result.collections.map((c: CollectionInfo) => c.name);
}

/**
 * Get detailed collection info
 */
async function getCollectionInfo(collection: string): Promise<CollectionInfo> {
  const response = await fetch(`${QDRANT_URL}/collections/${collection}`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Failed to get collection info: ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.result) {
    throw new Error(
      `No result in collection info response for "${collection}"`
    );
  }
  return data.result;
}

/**
 * Resolve effective exclude patterns used by crawl/map defaults:
 * - user-configured exclude paths
 * - user-configured or built-in exclude extensions (converted to path regex)
 * - built-in default exclude paths (unless disabled; this script never disables)
 */
function getEffectiveExcludePatterns(): string[] {
  const extensions = mergeExcludeExtensions(undefined, false);
  const extensionPatterns = extensionsToPaths(extensions);
  return mergeExcludePaths(undefined, false, extensionPatterns);
}

/**
 * Check data quality issues
 */
function checkDataQuality(points: QdrantPoint[]): DataQualityIssues {
  const issues: DataQualityIssues = {
    missingUrl: 0,
    missingContent: 0,
    emptyContent: 0,
    missingChunkIndex: 0,
  };

  for (const point of points) {
    if (!point.payload.url) issues.missingUrl++;
    if (point.payload.chunk_text == null) {
      // null or undefined — content is missing entirely
      issues.missingContent++;
    } else if (point.payload.chunk_text.trim().length === 0) {
      // present but blank — mutually exclusive with missingContent
      issues.emptyContent++;
    }
    if (point.payload.chunk_index === undefined) issues.missingChunkIndex++;
  }

  return issues;
}

/**
 * Count points/URLs that match effective exclude patterns.
 */
function checkExcludeViolations(
  points: QdrantPoint[],
  excludePatterns: string[]
): ExcludeViolationStats {
  if (excludePatterns.length === 0) {
    return { matchedPoints: 0, matchedUrls: 0, matchedIds: [], topUrls: [] };
  }

  const matchedByUrl = new Map<string, { points: number; pattern: string }>();
  const matchedIds: string[] = [];
  let matchedPoints = 0;

  for (const point of points) {
    const url = point.payload.url;
    if (!url) continue;

    let matchedPattern: string | null = null;
    for (const pattern of excludePatterns) {
      try {
        if (matchesPattern(url, pattern)) {
          matchedPattern = pattern;
          break;
        }
      } catch {
        // Ignore invalid patterns here; config command should validate,
        // but we keep this script resilient.
      }
    }

    if (!matchedPattern) continue;

    matchedPoints++;
    matchedIds.push(point.id);
    const existing = matchedByUrl.get(url);
    if (existing) {
      existing.points += 1;
    } else {
      matchedByUrl.set(url, { points: 1, pattern: matchedPattern });
    }
  }

  const topUrls = Array.from(matchedByUrl.entries())
    .map(([url, value]) => ({
      url,
      points: value.points,
      pattern: value.pattern,
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);

  return {
    matchedPoints,
    matchedUrls: matchedByUrl.size,
    matchedIds,
    topUrls,
  };
}

/**
 * Fetch all points from Qdrant collection
 */
async function fetchAllPoints(collection: string): Promise<QdrantPoint[]> {
  const points: QdrantPoint[] = [];
  let offset: string | null = null;
  const limit = 100;

  console.log(
    `Fetching points from ${QDRANT_URL}/collections/${collection}...`
  );

  while (true) {
    const scrollBody: {
      limit: number;
      with_payload: boolean;
      with_vector: boolean;
      offset?: string;
    } = {
      limit,
      with_payload: true,
      with_vector: false,
    };

    if (offset) {
      scrollBody.offset = offset;
    }

    const response = await fetch(
      `${QDRANT_URL}/collections/${collection}/points/scroll`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scrollBody),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch points: ${response.statusText}`);
    }

    const data = await response.json();
    const batch = data.result.points;

    if (batch.length === 0) {
      break;
    }

    points.push(...batch);

    if (!data.result.next_page_offset) {
      break;
    }

    offset = data.result.next_page_offset;
    process.stderr.write(`\rFetched ${points.length} points...`);
  }

  process.stderr.write(`\rFetched ${points.length} points total\n`);
  return points;
}

/**
 * Find duplicate chunks (same URL + chunk_index)
 */
function findDuplicates(points: QdrantPoint[]): DuplicateGroup[] {
  const chunkMap = new Map<string, string[]>();

  for (const point of points) {
    const url = point.payload.url;
    const chunkIndex = point.payload.chunk_index;

    if (!url) continue;

    // Create unique key: url + chunk_index
    // Use 'none' for missing chunk_index to avoid grouping with chunk 0
    const key = `${url}:::${chunkIndex ?? 'none'}`;

    const existingIds = chunkMap.get(key);
    if (existingIds) {
      existingIds.push(point.id);
    } else {
      chunkMap.set(key, [point.id]);
    }
  }

  const duplicates: DuplicateGroup[] = [];

  // Map.entries() is already iterable, no need for Array.from()
  for (const [key, ids] of chunkMap.entries()) {
    if (ids.length > 1) {
      const url = key.split(':::')[0];
      duplicates.push({ url, count: ids.length, ids });
    }
  }

  return duplicates.sort((a, b) => b.count - a.count);
}

/**
 * Delete points by IDs
 */
async function deletePoints(collection: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  console.log(`Deleting ${ids.length} points...`);

  const response = await fetch(
    `${QDRANT_URL}/collections/${collection}/points/delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: ids,
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to delete points: ${response.statusText}`);
  }

  console.log(`Deleted ${ids.length} points`);
}

/**
 * Display Qdrant health and collection stats
 */
async function displayHealthInfo(): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏥 Qdrant Health & Statistics`);
  console.log(`${'='.repeat(60)}`);

  try {
    // Get cluster info
    const clusterInfo = await getClusterInfo();
    console.log(`\n📊 Cluster Info:`);
    console.log(`  Version: ${clusterInfo.version}`);
    if (clusterInfo.commit) {
      console.log(`  Commit: ${clusterInfo.commit.substring(0, 8)}`);
    }

    // Get all collections
    const collections = await listCollections();
    console.log(`\n📚 Collections: ${collections.length} total`);

    if (collections.length === 0) {
      console.log('  (No collections found)');
      return;
    }

    // Get stats for each collection
    let totalPoints = 0;
    let totalVectors = 0;

    for (const collectionName of collections) {
      const info = await getCollectionInfo(collectionName);
      totalPoints += info.points_count || 0;
      totalVectors += info.vectors_count || 0;

      const status = info.status || 'unknown';
      const statusIcon =
        status === 'green' ? '✅' : status === 'yellow' ? '⚠️' : '❌';

      console.log(`\n  ${statusIcon} ${collectionName}`);
      console.log(`     Points: ${(info.points_count || 0).toLocaleString()}`);
      console.log(
        `     Vectors: ${(info.vectors_count || 0).toLocaleString()}`
      );
      console.log(
        `     Indexed: ${(info.indexed_vectors_count || 0).toLocaleString()}`
      );
      console.log(`     Segments: ${info.segments_count || 0}`);
      console.log(`     Status: ${status}`);

      if (info.optimizer_status) {
        console.log(`     Optimizer: ${info.optimizer_status}`);
      }
    }

    // Overall stats
    console.log(`\n💾 Overall Stats:`);
    console.log(`  Total points: ${totalPoints.toLocaleString()}`);
    console.log(`  Total vectors: ${totalVectors.toLocaleString()}`);
    console.log();
  } catch (error) {
    console.error(`❌ Failed to get health info: ${error}`);
    console.log();
  }
}

/**
 * Check a single collection
 */
async function checkCollection(
  collection: string,
  deleteDuplicates: boolean,
  deleteExcluded: boolean
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 Collection: ${collection}`);
  console.log(`${'='.repeat(60)}`);

  // Fetch all points
  const points = await fetchAllPoints(collection);
  const excludePatterns = getEffectiveExcludePatterns();

  if (points.length === 0) {
    console.log('No points found in collection\n');
    return;
  }

  // Check data quality
  console.log(`\n🔬 Data Quality Check`);
  const qualityIssues = checkDataQuality(points);
  const totalIssues =
    qualityIssues.missingUrl +
    qualityIssues.missingContent +
    qualityIssues.emptyContent +
    qualityIssues.missingChunkIndex;

  if (totalIssues === 0) {
    console.log('✅ No data quality issues found');
  } else {
    console.log(`⚠️  Found ${totalIssues} data quality issues:`);
    if (qualityIssues.missingUrl > 0) {
      console.log(`  Missing URL: ${qualityIssues.missingUrl}`);
    }
    if (qualityIssues.missingContent > 0) {
      console.log(`  Missing content: ${qualityIssues.missingContent}`);
    }
    if (qualityIssues.emptyContent > 0) {
      console.log(`  Empty content: ${qualityIssues.emptyContent}`);
    }
    if (qualityIssues.missingChunkIndex > 0) {
      console.log(`  Missing chunk_index: ${qualityIssues.missingChunkIndex}`);
    }
  }

  // Check exclude violations
  console.log(`\n🚫 Exclude Rules Check`);
  const excludeViolations = checkExcludeViolations(points, excludePatterns);
  if (excludeViolations.matchedPoints === 0) {
    console.log('✅ No points matched configured/default exclude rules');
  } else {
    console.log(
      `⚠️  Found ${excludeViolations.matchedPoints} points across ${excludeViolations.matchedUrls} URLs that match exclude rules`
    );
    console.log('Top 10 excluded-pattern matches:');
    for (const entry of excludeViolations.topUrls) {
      console.log(`  ${entry.points}x - ${entry.url}`);
      console.log(`       pattern: ${entry.pattern}`);
    }

    if (deleteExcluded) {
      const uniqueIds = Array.from(new Set(excludeViolations.matchedIds));
      await deletePoints(collection, uniqueIds);
      console.log(
        `🗑️  Deleted ${uniqueIds.length} points matching exclude rules`
      );
    } else {
      console.log(
        `\n💡 To delete exclude-rule matches, run:\n   pnpm tsx scripts/check-qdrant-quality.ts --collection ${collection} --delete-excluded`
      );
    }
  }

  // Check duplicates
  console.log(`\n📊 Duplicate Chunk Analysis`);
  const duplicates = findDuplicates(points);

  if (duplicates.length === 0) {
    console.log('✅ No duplicate chunks found');
  } else {
    console.log(`❌ Found ${duplicates.length} duplicate chunks\n`);

    const top10 = duplicates.slice(0, 10);
    console.log('Top 10 duplicates:');
    for (const dup of top10) {
      console.log(`  ${dup.count}x - ${dup.url}`);
    }

    if (duplicates.length > 10) {
      console.log(`  ... and ${duplicates.length - 10} more`);
    }

    const totalDuplicatePoints = duplicates.reduce(
      (sum, d) => sum + (d.count - 1),
      0
    );
    console.log(`\nTotal duplicate points: ${totalDuplicatePoints}`);

    if (deleteDuplicates) {
      const idsToDelete: string[] = [];
      for (const dup of duplicates) {
        // Keep first, delete rest
        idsToDelete.push(...dup.ids.slice(1));
      }
      await deletePoints(collection, idsToDelete);
    } else {
      console.log(
        `\n💡 To delete duplicates, run:\n   pnpm tsx scripts/check-qdrant-quality.ts --collection ${collection} --delete-duplicates`
      );
    }
  }

  // Calculate URL chunks
  const urlChunkCounts = new Map<string, number>();
  for (const point of points) {
    const url = point.payload.url;
    if (!url) continue;
    urlChunkCounts.set(url, (urlChunkCounts.get(url) || 0) + 1);
  }

  // Chunk distribution stats
  console.log(`\n📊 Chunk Distribution`);
  const counts = Array.from(urlChunkCounts.values()).sort((a, b) => a - b);
  if (counts.length > 0) {
    const min = counts.reduce((a, b) => Math.min(a, b), Infinity);
    const max = counts.reduce((a, b) => Math.max(a, b), -Infinity);
    const median = counts[Math.floor(counts.length / 2)];
    const avgChunksPerUrl = points.length / urlChunkCounts.size;

    console.log(`  Min chunks per URL: ${min}`);
    console.log(`  Median chunks per URL: ${median}`);
    console.log(`  Average chunks per URL: ${avgChunksPerUrl.toFixed(1)}`);
    console.log(`  Max chunks per URL: ${max}`);

    const highChunkUrls = counts.filter((c) => c > 50).length;
    if (highChunkUrls > 0) {
      console.log(`  URLs with >50 chunks: ${highChunkUrls}`);
    }
  }

  // Summary
  console.log(`\n📈 Summary`);
  console.log(`  Total points: ${points.length}`);
  console.log(`  Unique URLs: ${urlChunkCounts.size}`);
  console.log(`  Duplicate chunks: ${duplicates.length}`);
  console.log(`  Data quality issues: ${totalIssues}`);
  console.log(
    `  Exclude rule matches: ${excludeViolations.matchedPoints} points (${excludeViolations.matchedUrls} URLs)`
  );
  console.log();
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const deleteDuplicates = args.includes('--delete-duplicates');
  const deleteExcluded = args.includes('--delete-excluded');
  const checkAll = args.includes('--all');
  const healthOnly = args.includes('--health');

  // Parse --collection flag
  const collectionIndex = args.indexOf('--collection');
  const specifiedCollection =
    collectionIndex !== -1 && args[collectionIndex + 1]
      ? args[collectionIndex + 1]
      : null;

  console.log(`\n🔍 Qdrant Quality Check`);
  console.log(`URL: ${QDRANT_URL}`);
  const effectiveExcludes = getEffectiveExcludePatterns();
  console.log(`Exclude patterns loaded: ${effectiveExcludes.length}`);

  // Always show health info first (unless checking a specific collection)
  if (healthOnly) {
    await displayHealthInfo();
    return;
  }

  // Show health info for --all
  if (checkAll) {
    await displayHealthInfo();
  }

  if (checkAll) {
    // Check all collections
    console.log('\n📋 Mode: Check all collections');
    const collections = await listCollections();

    if (collections.length === 0) {
      console.log('\nNo collections found');
      return;
    }

    for (const collection of collections) {
      await checkCollection(collection, deleteDuplicates, deleteExcluded);
    }
  } else {
    // Check single collection
    const collection =
      specifiedCollection || process.env.QDRANT_COLLECTION || 'firecrawl';
    await checkCollection(collection, deleteDuplicates, deleteExcluded);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
