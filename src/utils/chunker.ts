/**
 * Markdown-aware hybrid text chunker
 */
import type { EffectiveUserSettings } from '../schemas/storage';
import { getSettings } from './settings';

export interface Chunk {
  text: string;
  index: number;
  header: string | null;
}

/**
 * Chunking configuration
 */
interface ChunkingConfig {
  maxChunkSize: number;
  targetChunkSize: number;
  overlapSize: number;
  minChunkSize: number;
}

/**
 * Split text into chunks using markdown-aware hybrid strategy:
 * 1. Split on markdown headers
 * 2. Split large blocks on double newlines (paragraphs)
 * 3. Fixed-size split with overlap for remaining large blocks
 * 4. Merge tiny chunks into previous
 *
 * @param text Text to chunk
 * @param chunkingConfig Optional chunking config (avoids getSettings() I/O when provided)
 */
export function chunkText(
  text: string,
  chunkingConfig?: EffectiveUserSettings['chunking']
): Chunk[] {
  const config: ChunkingConfig = chunkingConfig ?? getSettings().chunking;
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Step 1: Split on markdown headers
  const sections = splitOnHeaders(trimmed);

  // Step 2: Split large sections on paragraphs
  const paragraphed: { text: string; header: string | null }[] = [];
  for (const section of sections) {
    if (section.text.length <= config.maxChunkSize) {
      paragraphed.push(section);
    } else {
      const paragraphs = splitOnParagraphs(section.text);
      for (const p of paragraphs) {
        paragraphed.push({ text: p, header: section.header });
      }
    }
  }

  // Step 3: Fixed-size split for remaining large blocks
  const sized: { text: string; header: string | null }[] = [];
  for (const block of paragraphed) {
    if (block.text.length <= config.maxChunkSize) {
      sized.push(block);
    } else {
      const pieces = fixedSizeSplit(
        block.text,
        config.targetChunkSize,
        config.overlapSize
      );
      for (const piece of pieces) {
        sized.push({ text: piece, header: block.header });
      }
    }
  }

  // Step 4: Merge tiny chunks backward (same header) or forward (next chunk)
  const merged = mergeTinyChunks(sized, config.minChunkSize);

  // Assign indices
  return merged.map((chunk, index) => ({
    text: chunk.text,
    index,
    header: chunk.header,
  }));
}

/**
 * Split text on markdown headers (# through ######)
 */
function splitOnHeaders(
  text: string
): { text: string; header: string | null }[] {
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  const sections: { text: string; header: string | null }[] = [];

  let lastIndex = 0;
  let currentHeader: string | null = null;

  const matches = text.matchAll(headerRegex);

  for (const match of matches) {
    // Capture text before this header
    const index = match.index ?? 0;
    const beforeText = text.slice(lastIndex, index).trim();
    if (beforeText) {
      sections.push({ text: beforeText, header: currentHeader });
    }

    currentHeader = match[2].trim();
    lastIndex = index + match[0].length;
  }

  // Capture remaining text after last header
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    sections.push({ text: remaining, header: currentHeader });
  }

  // If no headers found, return entire text as single section
  if (sections.length === 0) {
    sections.push({ text: text.trim(), header: null });
  }

  return sections;
}

/**
 * Split text on double newlines (paragraph boundaries)
 */
function splitOnParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split text into fixed-size pieces with overlap
 */
function fixedSizeSplit(
  text: string,
  targetChunkSize: number,
  overlapSize: number
): string[] {
  const pieces: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + targetChunkSize, text.length);
    pieces.push(text.slice(start, end));

    if (end >= text.length) break;
    start = end - overlapSize;
  }

  return pieces;
}

/**
 * Merge tiny chunks (< MIN_CHUNK_SIZE) into adjacent chunks.
 * Prefers merging backward into previous chunk with same header.
 * Falls back to merging forward for headerless tiny chunks only.
 * Chunks with headers are never forward-merged (header is semantic).
 */
function mergeTinyChunks(
  chunks: { text: string; header: string | null }[],
  minChunkSize: number
): { text: string; header: string | null }[] {
  if (chunks.length === 0) return [];

  // First pass: merge backward into previous chunk with same header
  const afterBackward: { text: string; header: string | null }[] = [];
  for (const chunk of chunks) {
    const prev =
      afterBackward.length > 0 ? afterBackward[afterBackward.length - 1] : null;
    const canMergeBack =
      chunk.text.length < minChunkSize &&
      prev !== null &&
      prev.header === chunk.header;
    if (canMergeBack && prev !== null) {
      prev.text += `\n\n${chunk.text}`;
    } else {
      afterBackward.push({ ...chunk });
    }
  }

  // Second pass: merge remaining tiny chunks forward into a non-tiny neighbor.
  // Only merge if the next chunk is large enough (>= MIN_CHUNK_SIZE),
  // so we don't collapse multiple small headed sections together.
  const result: { text: string; header: string | null }[] = [];
  for (let i = 0; i < afterBackward.length; i++) {
    const chunk = afterBackward[i];
    const isTiny = chunk.text.length < minChunkSize;
    const hasNext = i + 1 < afterBackward.length;
    const nextIsLarge =
      hasNext && afterBackward[i + 1].text.length >= minChunkSize;
    if (isTiny && nextIsLarge) {
      // Merge tiny chunk into the next (larger) chunk
      afterBackward[i + 1].text =
        `${chunk.text}\n\n${afterBackward[i + 1].text}`;
    } else {
      result.push(chunk);
    }
  }

  return result;
}
