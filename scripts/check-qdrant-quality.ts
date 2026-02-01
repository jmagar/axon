#!/usr/bin/env tsx
/**
 * Check Qdrant collection for duplicate chunks
 *
 * Usage:
 *   pnpm tsx scripts/check-qdrant-quality.ts
 *   pnpm tsx scripts/check-qdrant-quality.ts --collection firecrawl
 *   pnpm tsx scripts/check-qdrant-quality.ts --delete-duplicates
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv();

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:53333';
const COLLECTION = process.env.QDRANT_COLLECTION || 'firecrawl';

interface QdrantPoint {
  id: string;
  payload: {
    url?: string;
    content?: string;
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

/**
 * Fetch all points from Qdrant collection
 */
async function fetchAllPoints(): Promise<QdrantPoint[]> {
  const points: QdrantPoint[] = [];
  let offset: string | null = null;
  const limit = 100;

  console.log(
    `Fetching points from ${QDRANT_URL}/collections/${COLLECTION}...`
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
      `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
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
async function deletePoints(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  console.log(`Deleting ${ids.length} points...`);

  const response = await fetch(
    `${QDRANT_URL}/collections/${COLLECTION}/points/delete`,
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
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const deleteDuplicates = args.includes('--delete-duplicates');

  console.log(`\n🔍 Qdrant Quality Check`);
  console.log(`Collection: ${COLLECTION}`);
  console.log(`URL: ${QDRANT_URL}\n`);

  // Fetch all points
  const points = await fetchAllPoints();

  if (points.length === 0) {
    console.log('No points found in collection');
    return;
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
      await deletePoints(idsToDelete);
    } else {
      console.log(
        `\nRun with --delete-duplicates to remove them (keeps first occurrence)`
      );
    }
  }

  // Summary
  console.log(`\n📈 Summary`);
  console.log(`Total points: ${points.length}`);
  console.log(
    `Unique URLs: ${new Set(points.map((p) => p.payload.url).filter(Boolean)).size}`
  );
  console.log(`Duplicate chunks: ${duplicates.length}`);

  // Calculate average chunks per URL
  const urlChunkCounts = new Map<string, number>();
  for (const point of points) {
    const url = point.payload.url;
    if (!url) continue;
    urlChunkCounts.set(url, (urlChunkCounts.get(url) || 0) + 1);
  }

  const avgChunksPerUrl = points.length / urlChunkCounts.size;
  console.log(`Average chunks per URL: ${avgChunksPerUrl.toFixed(1)}`);
  console.log();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
