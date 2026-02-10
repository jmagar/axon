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
 *   pnpm tsx scripts/check-qdrant-quality.ts --collection firecrawl --delete-duplicates
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv();

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:53333';

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
  const response = await fetch(`${QDRANT_URL}/`);

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
  const response = await fetch(`${QDRANT_URL}/collections`);

  if (!response.ok) {
    throw new Error(`Failed to list collections: ${response.statusText}`);
  }

  const data = await response.json();
  return data.result.collections.map((c: CollectionInfo) => c.name);
}

/**
 * Get detailed collection info
 */
async function getCollectionInfo(collection: string): Promise<CollectionInfo> {
  const response = await fetch(`${QDRANT_URL}/collections/${collection}`);

  if (!response.ok) {
    throw new Error(`Failed to get collection info: ${response.statusText}`);
  }

  const data = await response.json();
  return data.result;
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
    if (!point.payload.chunk_text) issues.missingContent++;
    if (
      typeof point.payload.chunk_text === 'string' &&
      point.payload.chunk_text.trim().length === 0
    ) {
      issues.emptyContent++;
    }
    if (point.payload.chunk_index === undefined) issues.missingChunkIndex++;
  }

  return issues;
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
    const key = `${url}:::${chunkIndex ?? 0}`;

    const existingIds = chunkMap.get(key);
    if (existingIds) {
      existingIds.push(point.id);
    } else {
      chunkMap.set(key, [point.id]);
    }
  }

  const duplicates: DuplicateGroup[] = [];

  for (const [key, ids] of Array.from(chunkMap.entries())) {
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
  deleteDuplicates: boolean
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 Collection: ${collection}`);
  console.log(`${'='.repeat(60)}`);

  // Fetch all points
  const points = await fetchAllPoints(collection);

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
    const min = Math.min(...counts);
    const max = Math.max(...counts);
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
  console.log();
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const deleteDuplicates = args.includes('--delete-duplicates');
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
      await checkCollection(collection, deleteDuplicates);
    }
  } else {
    // Check single collection
    const collection =
      specifiedCollection || process.env.QDRANT_COLLECTION || 'firecrawl';
    await checkCollection(collection, deleteDuplicates);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
