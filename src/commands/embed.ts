/**
 * Embed command implementation
 * Embeds content from URL, file, or stdin into Qdrant via TEI
 */

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import type { IContainer } from '../container/types';
import type { EmbedOptions, EmbedResult } from '../types/embed';
import { chunkText } from '../utils/chunker';
import {
  formatJson,
  handleCommandError,
  processCommandResult,
  shouldOutputJson,
  writeCommandOutput,
} from '../utils/command';
import {
  buildFiltersEcho,
  CANONICAL_EMPTY_STATE,
  formatHeaderBlock,
} from '../utils/style-output';
import { fmt, icons } from '../utils/theme';
import { isUrl } from '../utils/url';
import {
  requireContainer,
  resolveCollectionName,
  validateEmbeddingUrls,
} from './shared';

/**
 * Read stdin as a string
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Derive a stable local source ID from a file path.
 *
 * Format: <cwd basename>/<repo-relative path>
 * Example: axon/docs/design/auth.md
 */
export function deriveLocalSourceId(
  inputPath: string,
  cwd: string = process.cwd()
): string {
  const { namespace, rootDir } = resolveSourceNamespace(cwd);
  const absolutePath = path.resolve(cwd, inputPath);
  const relativePath = path.relative(rootDir, absolutePath);
  const useRelative =
    relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath);
  if (useRelative) {
    const normalizedPath = relativePath
      .split(path.sep)
      .join('/')
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '');
    return `${namespace}/${normalizedPath}`;
  }

  const externalHash = createHash('sha256')
    .update(absolutePath, 'utf-8')
    .digest('hex')
    .slice(0, 12);
  const safeBaseName = path
    .basename(absolutePath)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const namePart = safeBaseName || 'file';
  return `${namespace}/external/${namePart}-${externalHash}`;
}

/**
 * Derive a stable source ID for stdin content.
 *
 * Format: <cwd basename>/stdin/<content hash>
 * Example: axon/stdin/4a44dc15364204a8
 */
export function deriveStdinSourceId(
  content: string,
  cwd: string = process.cwd()
): string {
  const { namespace } = resolveSourceNamespace(cwd);
  const hash = createHash('sha256')
    .update(content, 'utf-8')
    .digest('hex')
    .slice(0, 16);
  return `${namespace}/stdin/${hash}`;
}

/**
 * Resolve stable source namespace and root directory.
 *
 * Uses git root when available so subdirectory execution keeps the same
 * project namespace; falls back to cwd otherwise.
 */
function resolveSourceNamespace(cwd: string): {
  namespace: string;
  rootDir: string;
} {
  const repoRoot = findGitRoot(cwd);
  const rootDir = repoRoot ?? cwd;
  const namespace = path.basename(rootDir) || 'local';
  return { namespace, rootDir };
}

function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Derive a domain-like namespace from source ID when URL parsing fails.
 * For local IDs like "axon/docs/design/auth.md", this returns "axon".
 */
function deriveDomain(sourceId: string): string {
  try {
    return new URL(sourceId).hostname;
  } catch {
    const firstSegment = sourceId
      .replace(/^\/+/, '')
      .split('/')
      .find((segment) => segment.length > 0);
    return firstSegment ?? 'unknown';
  }
}

/**
 * Infer source type from a stored source ID.
 */
export function inferSourceType(sourceId: string): 'url' | 'stdin' | 'file' {
  try {
    const parsed = new URL(sourceId);
    if (parsed.protocol && parsed.protocol !== ':') {
      return 'url';
    }
  } catch {
    // Non-URL source IDs are expected for local file/stdin modes.
  }

  const normalized = sourceId.replace(/^\/+/, '');
  if (normalized.includes('/stdin/') || normalized.startsWith('stdin/')) {
    return 'stdin';
  }

  return 'file';
}

/**
 * Build a safe collection name from a namespace.
 * Replaces invalid characters with underscores and trims separators.
 */
function toCollectionName(namespace: string): string {
  const sanitized = namespace
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[_-]+/, '')
    .replace(/[_-]+$/, '');
  return sanitized || 'axon';
}

function listDirectoryFiles(inputDir: string): string[] {
  const files: string[] = [];
  const stack = [path.resolve(inputDir)];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function toPosixPath(inputPath: string): string {
  return inputPath.split(path.sep).join('/');
}

function derivePayloadTitle(input: {
  explicitTitle?: string;
  sourcePathRel?: string;
  fileName?: string;
  url: string;
}): string {
  if (input.explicitTitle && input.explicitTitle.trim().length > 0) {
    return input.explicitTitle.trim();
  }
  if (input.sourcePathRel && input.sourcePathRel.trim().length > 0) {
    return input.sourcePathRel.trim();
  }
  if (input.fileName && input.fileName.trim().length > 0) {
    return input.fileName.trim();
  }
  return input.url;
}

function resolveRelativeMetadataPath(targetPath: string, cwd: string): string {
  const { rootDir } = resolveSourceNamespace(cwd);
  const relativePath = path.relative(rootDir, targetPath);
  const useRelative =
    relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath);
  if (useRelative) {
    return toPosixPath(relativePath)
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '');
  }

  const safeBaseName = path
    .basename(targetPath)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `external/${safeBaseName || 'file'}`;
}

/**
 * Execute embed command
 */
export async function executeEmbed(
  container: IContainer,
  options: EmbedOptions
): Promise<EmbedResult> {
  try {
    const teiUrl = container.config.teiUrl;
    const qdrantUrl = container.config.qdrantUrl;

    const validation = validateEmbeddingUrls(teiUrl, qdrantUrl, 'embed');
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    const inputPath = path.resolve(options.input);
    const inputExists = fs.existsSync(options.input);
    let isDirectoryInput = false;
    if (inputExists) {
      try {
        isDirectoryInput = fs.statSync(inputPath).isDirectory();
      } catch {
        isDirectoryInput = false;
      }
    }

    if (isDirectoryInput) {
      if (options.url) {
        return {
          success: false,
          error:
            'Directory input does not support --url/--source-id. Embed files individually for custom source IDs.',
        };
      }

      const files = listDirectoryFiles(inputPath);
      if (files.length === 0) {
        return {
          success: false,
          error: `Directory "${options.input}" contains no files to embed.`,
        };
      }

      const ingestId = options.ingestId ?? randomUUID();
      let totalChunksEmbedded = 0;
      let filesEmbedded = 0;
      let collectionName: string | undefined;

      for (const filePath of files) {
        const result = await executeEmbed(container, {
          ...options,
          input: filePath,
          ingestId,
          ingestRoot: inputPath,
        });

        if (!result.success) {
          return {
            success: false,
            error: `Failed to embed "${filePath}": ${result.error}`,
          };
        }

        if (!result.data) {
          return {
            success: false,
            error: `Failed to embed "${filePath}": missing embed result data`,
          };
        }

        totalChunksEmbedded += result.data.chunksEmbedded;
        filesEmbedded += 1;
        collectionName = result.data.collection;
      }

      return {
        success: true,
        data: {
          url: inputPath,
          chunksEmbedded: totalChunksEmbedded,
          collection: collectionName ?? resolveCollectionName(container),
          filesEmbedded,
        },
      };
    }

    let content: string;
    let url: string;
    let title: string | undefined;
    let sourceType: 'url' | 'stdin' | 'file';
    let localNamespace: string | undefined;
    const fileMetadata: Record<string, unknown> = {};

    if (options.input === '-') {
      // Stdin mode
      content = options.stdinContent ?? (await readStdin());
      url = options.url ?? deriveStdinSourceId(content);
      sourceType = 'stdin';
      localNamespace = resolveSourceNamespace(process.cwd()).namespace;
    } else if (isUrl(options.input)) {
      // URL mode -- scrape first
      const app = container.getAxonClient();
      const result = await app.scrape(options.input, {
        formats: ['markdown'],
      });
      content = result.markdown || '';
      url = options.input;
      title = result.metadata?.title;
      sourceType = 'url';
    } else if (fs.existsSync(options.input)) {
      // File mode
      const absolutePath = path.resolve(options.input);
      const { namespace } = resolveSourceNamespace(process.cwd());
      content = fs.readFileSync(options.input, 'utf-8');
      url = options.url ?? deriveLocalSourceId(options.input);
      sourceType = 'file';
      localNamespace = namespace;

      let fileStats: fs.Stats | null = null;
      try {
        fileStats = fs.statSync(absolutePath);
      } catch {
        // Best-effort metadata fallback for environments where stat is unavailable.
      }

      const extension = path.extname(absolutePath);
      const sourcePathRel = resolveRelativeMetadataPath(
        absolutePath,
        process.cwd()
      );
      const ingestRootPath = path.resolve(
        options.ingestRoot ?? path.dirname(absolutePath)
      );

      fileMetadata.source_path_rel = sourcePathRel;
      fileMetadata.file_name = path.basename(absolutePath);
      fileMetadata.file_ext = extension.startsWith('.')
        ? extension.slice(1)
        : extension;
      fileMetadata.file_size_bytes =
        fileStats?.size ?? Buffer.byteLength(content, 'utf-8');
      fileMetadata.file_modified_at =
        fileStats?.mtime.toISOString() ?? new Date().toISOString();
      fileMetadata.ingest_root = resolveRelativeMetadataPath(
        ingestRootPath,
        process.cwd()
      );
      fileMetadata.ingest_id = options.ingestId ?? randomUUID();
      title = derivePayloadTitle({
        explicitTitle: title,
        sourcePathRel,
        fileName: String(fileMetadata.file_name),
        url,
      });
    } else {
      return {
        success: false,
        error: `Input "${options.input}" is not a valid URL, file, or "-" for stdin.`,
      };
    }

    // Default local embeds (file/stdin) into repo-named collection unless user overrides.
    const effectiveCollection =
      options.collection ??
      (sourceType === 'url'
        ? undefined
        : toCollectionName(localNamespace ?? 'axon'));
    const collection = resolveCollectionName(container, effectiveCollection);

    const trimmed = content.trim();
    if (!trimmed) {
      return {
        success: false,
        error: 'No content to embed.',
      };
    }

    // Get services from container
    const teiService = container.getTeiService();
    const qdrantService = container.getQdrantService();

    // Get TEI dimension
    const teiInfo = await teiService.getTeiInfo();

    // Ensure collection exists
    await qdrantService.ensureCollection(collection, teiInfo.dimension);

    // Chunk content
    const chunks = options.noChunk
      ? [{ text: trimmed, index: 0, header: null }]
      : chunkText(trimmed);

    if (chunks.length === 0) {
      return {
        success: false,
        error: 'Content produced no chunks after processing.',
      };
    }

    // Generate embeddings
    const texts = chunks.map((c) => c.text);
    const vectors = await teiService.embedChunks(texts);

    // Delete old vectors then upsert new ones
    await qdrantService.deleteByUrl(collection, url);

    const now = new Date().toISOString();
    const domain = deriveDomain(url);

    const points = chunks.map((chunk, i) => ({
      id: randomUUID(),
      vector: vectors[i],
      payload: {
        url,
        title: derivePayloadTitle({
          explicitTitle: title,
          sourcePathRel:
            typeof fileMetadata.source_path_rel === 'string'
              ? fileMetadata.source_path_rel
              : undefined,
          fileName:
            typeof fileMetadata.file_name === 'string'
              ? fileMetadata.file_name
              : undefined,
          url,
        }),
        domain,
        chunk_index: chunk.index,
        chunk_text: chunk.text,
        chunk_header: chunk.header,
        total_chunks: chunks.length,
        source_command: 'embed',
        source_type: sourceType,
        content_type: 'text',
        scraped_at: now,
        ...fileMetadata,
      },
    }));

    await qdrantService.upsertPoints(collection, points);

    return {
      success: true,
      data: {
        url,
        chunksEmbedded: chunks.length,
        collection,
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
 * Handle embed command output
 */
export async function handleEmbedCommand(
  container: IContainer,
  options: EmbedOptions
): Promise<void> {
  await processCommandResult(
    await executeEmbed(container, options),
    options,
    (data) =>
      [
        ...formatHeaderBlock({
          title: 'Embed Result',
          summary:
            data.filesEmbedded && data.filesEmbedded > 1
              ? `Files embedded: ${data.filesEmbedded} | Chunks embedded: ${data.chunksEmbedded} | Collection: ${data.collection}`
              : `Chunks embedded: ${data.chunksEmbedded} | Collection: ${data.collection}`,
          filters: buildFiltersEcho([
            ['collection', options.collection],
            ['noChunk', options.noChunk],
          ]),
        }),
        data.filesEmbedded && data.filesEmbedded > 1
          ? `${icons.success} Embedded ${data.filesEmbedded} files (${data.chunksEmbedded} chunks)`
          : `${icons.success} Embedded ${data.chunksEmbedded} chunks`,
        data.filesEmbedded && data.filesEmbedded > 1
          ? `Directory: ${data.url}`
          : `URL: ${data.url}`,
        `Collection: ${data.collection}`,
      ].join('\n')
  );
}

import { Command } from 'commander';
import { createContainerWithOverride } from '../container/ContainerFactory';
import { ensureAuthenticated } from '../utils/auth';
import { loadCredentials } from '../utils/credentials';
import {
  cleanupEmbedQueue,
  clearEmbedQueue,
  getEmbedJob,
  removeEmbedJob,
} from '../utils/embed-queue';
import { normalizeUrl } from '../utils/url';

/**
 * Handle embed cancel command
 */
async function handleCancelCommand(
  jobId: string
): Promise<{ success: boolean; error?: string }> {
  const job = await getEmbedJob(jobId);

  if (!job) {
    return {
      success: false,
      error: `Embed job ${jobId} not found`,
    };
  }

  await removeEmbedJob(jobId);
  console.log(`${icons.success} Cancelled embed job ${fmt.dim(jobId)}`);
  return { success: true };
}

async function handleClearCommand(): Promise<{
  success: boolean;
  removed?: number;
  error?: string;
}> {
  try {
    const removed = await clearEmbedQueue();
    console.log(
      `${icons.success} Cleared ${removed} embedding job${removed === 1 ? '' : 's'}`
    );
    return { success: true, removed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleCleanupCommand(): Promise<{
  success: boolean;
  removed?: number;
  error?: string;
}> {
  try {
    const result = await cleanupEmbedQueue();
    console.log(
      `${icons.success} Cleanup removed ${result.removedTotal} embedding job${result.removedTotal === 1 ? '' : 's'} ${fmt.dim(`(failed: ${result.removedFailed}, stale pending: ${result.removedStalePending}, stale processing: ${result.removedStaleProcessing})`)}`
    );
    return { success: true, removed: result.removedTotal };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handleStatusCommand(
  jobId: string,
  options: { output?: string; json?: boolean; pretty?: boolean }
): Promise<{ success: boolean; error?: string }> {
  const job = await getEmbedJob(jobId);
  if (!job) {
    return {
      success: false,
      error: `Embed job ${jobId} not found`,
    };
  }

  const useJson = shouldOutputJson(options) || Boolean(options.output);
  if (useJson) {
    await writeCommandOutput(
      formatJson({ success: true, data: job }, options.pretty),
      options
    );
    return { success: true };
  }

  const progress =
    job.totalDocuments !== undefined && job.processedDocuments !== undefined
      ? `${job.processedDocuments}/${job.totalDocuments}`
      : 'n/a';

  const lines = formatHeaderBlock({
    title: `Embed Status for ${job.jobId}`,
    summary: `Status: ${job.status} | Progress: ${progress}`,
    filters: buildFiltersEcho([['jobId', job.jobId]]),
    includeFreshness: true,
  });

  if (
    job.totalDocuments !== undefined &&
    job.totalDocuments === 0 &&
    job.processedDocuments === 0
  ) {
    lines.push(`  ${CANONICAL_EMPTY_STATE}`);
    lines.push('');
    console.log(lines.join('\n'));
    return { success: true };
  }

  lines.push(`Job ID: ${job.jobId}`);
  lines.push(`Status: ${job.status}`);
  lines.push(`URL: ${job.url}`);
  lines.push(`Retries: ${job.retries}/${job.maxRetries}`);
  lines.push(`Progress: ${progress}`);
  if (job.lastError) {
    lines.push(`Last Error: ${job.lastError}`);
  }
  console.log(lines.join('\n'));
  return { success: true };
}

/**
 * Create and configure the embed command
 *
 * UX Pattern: Uses subcommands for actions (e.g., `embed cancel <id>`)
 * instead of option flags. This is the preferred pattern for CLI UX:
 * - Better discoverability
 * - Clear semantic intent
 * - Follows standard CLI conventions (resource action target)
 */
export function createEmbedCommand(): Command {
  const embedCmd = new Command('embed').description(
    'Embed content into Qdrant vector database'
  );

  // Default embed action (when no subcommand is used)
  embedCmd
    .argument(
      '[input]',
      'URL to scrape and embed, file path, directory path, or "-" for stdin'
    )
    .option(
      '--url <url>',
      'Explicit source ID for metadata (optional for file/stdin)'
    )
    .option(
      '--source-id <id>',
      'Alias for --url; explicit source ID for metadata'
    )
    .option('--collection <name>', 'Qdrant collection name (default: axon)')
    .option(
      '--no-chunk',
      'Disable chunking, embed as single vector (default: false)',
      false
    )
    .option('-k, --api-key <key>', 'API key (overrides global --api-key)')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .action(async (input: string | undefined, options, command: Command) => {
      let stdinContent: string | undefined;

      // If no input provided, support piped stdin as implicit "-" input.
      if (!input) {
        if (process.stdin.isTTY) {
          command.help();
          return;
        }

        stdinContent = await readStdin();
        if (!stdinContent.trim()) {
          command.help();
          return;
        }
        input = '-';
      }

      let container = requireContainer(command);

      // Normalize URL input (but not file paths or stdin "-")
      const normalizedInput = isUrl(input) ? normalizeUrl(input) : input;

      // Conditionally require auth only for URL input
      if (
        normalizedInput.startsWith('http://') ||
        normalizedInput.startsWith('https://')
      ) {
        const apiKey = await ensureAuthenticated(container.config.apiKey);
        if (apiKey !== container.config.apiKey) {
          const storedCredentials = loadCredentials();
          container = createContainerWithOverride(container, {
            apiKey,
            apiUrl: storedCredentials?.apiUrl ?? container.config.apiUrl,
          });
        }
      }

      await handleEmbedCommand(container, {
        input: normalizedInput,
        url: options.sourceId ?? options.url,
        stdinContent,
        collection: options.collection,
        noChunk: !options.chunk,
        apiKey: options.apiKey,
        output: options.output,
        json: options.json,
      });
    });

  // Add cancel subcommand
  embedCmd
    .command('cancel')
    .description('Cancel a pending embedding job')
    .argument('<job-id>', 'Job ID to cancel')
    .action(async (jobId: string) => {
      handleCommandError(await handleCancelCommand(jobId));
    });

  embedCmd
    .command('clear')
    .description('Clear the entire embedding queue')
    .action(async () => {
      handleCommandError(await handleClearCommand());
    });

  embedCmd
    .command('cleanup')
    .description('Cleanup failed and stale/stalled embedding jobs')
    .action(async () => {
      handleCommandError(await handleCleanupCommand());
    });

  embedCmd
    .command('status')
    .description('Get embedding job status by ID')
    .argument('<job-id>', 'Embedding job ID')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON format', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .action(async (jobId: string, options) => {
      handleCommandError(
        await handleStatusCommand(jobId, {
          output: options.output,
          json: options.json,
          pretty: options.pretty,
        })
      );
    });

  return embedCmd;
}
