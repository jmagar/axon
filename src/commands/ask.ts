/**
 * Ask command implementation
 * Q&A over embedded documents using Claude CLI
 */

import { spawn } from 'node:child_process';
import { Command } from 'commander';
import pLimit from 'p-limit';
import type { IContainer } from '../container/types';
import type { AskOptions, AskResult, AskSource } from '../types/ask';
import { getSettings } from '../utils/settings';
import { fmt, icons } from '../utils/theme';
import { executeQuery } from './query';
import { executeRetrieve } from './retrieve';
import {
  requireContainer,
  resolveCollectionName,
  validateEmbeddingUrls,
} from './shared';

function resolveAskModel(explicitModel?: string): string {
  return explicitModel || process.env.ASK_CLI || 'haiku';
}

function resolveAndValidateMaxContext(
  maxContext?: number
): { valid: true; value: number } | { valid: false; error: string } {
  const resolved = maxContext ?? 100000;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    return {
      valid: false,
      error: `Invalid --max-context value: ${String(maxContext)}. It must be a positive safe integer.`,
    };
  }
  return { valid: true, value: resolved };
}

/**
 * Execute ask command
 * 1. Query Qdrant for relevant documents
 * 2. Retrieve full content for top results
 * 3. Format context and spawn `claude` CLI subprocess
 * 4. Stream Claude's response back
 * @param container DI container with services
 * @param options Ask options
 * @returns AskResult with formatted context
 */
export async function executeAsk(
  container: IContainer,
  options: AskOptions
): Promise<AskResult> {
  try {
    const teiUrl = container.config.teiUrl;
    const qdrantUrl = container.config.qdrantUrl;
    const collection = resolveCollectionName(container, options.collection);

    // Validate embedding services are configured
    const validation = validateEmbeddingUrls(teiUrl, qdrantUrl, 'ask');
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    const limit = options.limit || getSettings().ask.limit;
    // Model precedence: --model > ASK_CLI > default
    const model = resolveAskModel(options.model);
    const maxContextValidation = resolveAndValidateMaxContext(
      options.maxContext
    );
    if (!maxContextValidation.valid) {
      return {
        success: false,
        error: maxContextValidation.error,
      };
    }
    const maxContextChars = maxContextValidation.value;

    // Step 1: Query Qdrant for relevant documents
    console.error(
      fmt.dim(`${icons.processing} Searching for relevant documents...`)
    );

    const queryResult = await executeQuery(container, {
      query: options.query,
      limit,
      domain: options.domain,
      collection,
      json: true, // Get structured data
    });

    if (!queryResult.success || !queryResult.data) {
      return {
        success: false,
        error: queryResult.error || 'Query failed with no results',
      };
    }

    if (queryResult.data.length === 0) {
      return {
        success: false,
        error:
          'No relevant documents found. Try a different query or domain filter.',
      };
    }

    // Get unique URLs from query results, keeping highest-scoring item per URL
    const urlMap = new Map<string, (typeof queryResult.data)[0]>();
    for (const item of queryResult.data) {
      const baseUrl = item.url.split('#')[0]; // Strip fragment
      if (!urlMap.has(baseUrl)) {
        urlMap.set(baseUrl, item); // Keep first (highest-scoring) occurrence
      }
    }
    const uniqueUrls = Array.from(urlMap.values()).slice(0, limit);

    console.error(
      fmt.dim(`${icons.success} Found ${uniqueUrls.length} relevant documents`)
    );
    console.error(
      fmt.dim(`${icons.processing} Retrieving full document content...`)
    );

    // Step 2: Retrieve full documents (concurrency-limited)
    const concurrencyLimit = pLimit(5);
    const retrieveResults = await Promise.all(
      uniqueUrls.map((item) =>
        concurrencyLimit(() =>
          executeRetrieve(container, {
            url: item.url,
            collection,
            json: true,
          })
        )
      )
    );

    const successfulRetrieves = retrieveResults.filter(
      (r) => r.success && r.data
    );

    if (successfulRetrieves.length === 0) {
      return {
        success: false,
        error: 'Failed to retrieve any documents',
      };
    }

    console.error(
      fmt.dim(
        `${icons.success} Retrieved ${successfulRetrieves.length} documents`
      )
    );
    // Determine AI name from model
    const aiName = model.startsWith('gemini-') ? 'Gemini' : 'Claude';
    console.error(fmt.dim(`${icons.arrow} Asking ${aiName}...`));
    console.error(''); // Blank line before AI response

    // Step 3: Build formatted context
    const separator = '---';

    // Build documents context incrementally with size limit
    const documentParts: string[] = [];
    let totalChars = 0;
    let includedDocs = 0;

    for (let idx = 0; idx < successfulRetrieves.length; idx++) {
      const r = successfulRetrieves[idx];
      if (!r.data) continue;

      const docPart = `## Document ${idx + 1}: ${r.data.url}\n\n${r.data.content}`;
      const docSize = docPart.length + separator.length + 2; // +2 for newlines

      // Check if adding this document would exceed limit
      if (totalChars + docSize > maxContextChars) {
        // If we haven't included any documents yet, the limit is too small
        if (includedDocs === 0) {
          return {
            success: false,
            error: `Context size limit (${maxContextChars} chars) too small to include any documents. Try increasing --max-context.`,
          };
        }
        // Otherwise, stop adding more documents
        console.error(
          fmt.warning(
            `${icons.warning} Context size limit reached (${maxContextChars} chars). Included ${includedDocs}/${successfulRetrieves.length} documents.`
          )
        );
        break;
      }

      documentParts.push(docPart);
      totalChars += docSize;
      includedDocs++;
    }

    const documentsContext = documentParts.join(`\n\n${separator}\n\n`);
    const context = `I have a question about these documents:\n\n${documentsContext}\n\n${separator}\n\nQuestion: ${options.query}`;

    // Only include sources whose content was actually retrieved
    const retrievedUrls = new Set(successfulRetrieves.map((r) => r.data?.url));
    const sources: AskSource[] = uniqueUrls
      .filter((item) => retrievedUrls.has(item.url))
      .map((item) => ({
        url: item.url,
        title: item.title,
        score: item.score,
      }));

    // Step 4: Spawn AI CLI subprocess and pipe context to it
    // Supports both claude and gemini CLIs.
    const answer = await callAICLI(context, model);

    return {
      success: true,
      data: {
        query: options.query,
        context,
        sources,
        documentsRetrieved: successfulRetrieves.length,
        answer,
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
 * Call AI CLI tool as subprocess (claude or gemini)
 * Pipes context to stdin, captures stdout
 * @param context Formatted context to send to AI
 * @param model Model to use (e.g., sonnet, opus, haiku for claude; gemini-2.5-pro, gemini-2.5-flash for gemini)
 * @returns AI's response text
 */
async function callAICLI(context: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Determine CLI from model name
    const isGemini = model.startsWith('gemini-');
    const cliTool = isGemini ? 'gemini' : 'claude';

    // Build arguments - both CLIs use --model
    // Claude CLI requires -p (print mode) for non-interactive stdin piping
    const args = isGemini ? ['--model', model] : ['-p', '--model', model];

    // Spawn the appropriate CLI
    const aiProcess = spawn(cliTool, args, {
      stdio: ['pipe', 'pipe', 'inherit'], // stdin: pipe, stdout: pipe, stderr: inherit (shows progress)
    });

    let output = '';

    // Capture stdout (AI's response)
    aiProcess.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text); // Stream to terminal in real-time
    });

    // Handle stdin errors (e.g. child exits before stdin is flushed)
    aiProcess.stdin.on('error', () => {
      // Ignore stdin write errors - the close handler will report the real error
    });

    // Write context to stdin
    aiProcess.stdin.write(context);
    aiProcess.stdin.end();

    // Handle process exit
    aiProcess.on('close', (code: number | null) => {
      if (code === null) {
        reject(
          new Error(
            `${cliTool} CLI was killed by a signal. Check stderr output above.`
          )
        );
      } else if (code !== 0) {
        reject(
          new Error(
            `${cliTool} CLI exited with code ${code}. Check stderr output above.`
          )
        );
      } else {
        resolve(output.trim());
      }
    });

    aiProcess.on('error', (err: Error) => {
      reject(
        new Error(
          `Failed to spawn ${cliTool} CLI: ${err.message}. Make sure '${cliTool}' is installed and in PATH.`
        )
      );
    });
  });
}

/**
 * Handle ask command
 * Claude's response is already streamed to stdout during execution
 * This just shows sources and metadata on stderr
 */
export async function handleAskCommand(
  container: IContainer,
  options: AskOptions
): Promise<void> {
  const result = await executeAsk(container, options);

  if (!result.success) {
    console.error(fmt.error(`${icons.error} ${result.error}`));
    process.exitCode = 1;
    return;
  }

  if (!result.data) {
    console.error(fmt.error(`${icons.error} No data returned`));
    process.exitCode = 1;
    return;
  }

  // Claude's response was already streamed to stdout during executeAsk
  // Now show sources and metadata on stderr
  console.error('');
  console.error(fmt.dim('─'.repeat(60)));
  console.error(fmt.bold(fmt.dim('Sources:')));
  for (let i = 0; i < result.data.sources.length; i++) {
    const source = result.data.sources[i];
    const title = source.title || 'Untitled';
    const score = source.score.toFixed(2);
    console.error(`  ${i + 1}. [${score}] ${source.url}`);
    console.error(`     ${fmt.dim(title)}`);
  }
  console.error('');
  console.error(
    fmt.dim(
      `${icons.info} Retrieved ${result.data.documentsRetrieved} documents`
    )
  );
}

/**
 * Create ask command
 */
export function createAskCommand(): Command {
  const settings = getSettings();

  const askCmd = new Command('ask')
    .description(
      'Ask a question about your embedded documents (calls claude or gemini CLI)'
    )
    .argument('<query>', 'Question to ask about your documents')
    .option(
      '--limit <number>',
      'Maximum number of documents to retrieve (default: 10)',
      (val) => parseInt(val, 10),
      settings.ask.limit
    )
    .option('--domain <domain>', 'Filter results by domain')
    .option(
      '--collection <name>',
      'Qdrant collection name (default: firecrawl)'
    )
    .option(
      '--model <name>',
      'Model: opus/sonnet/haiku (claude) or gemini-3-pro-preview/gemini-3-flash-preview (gemini). Defaults: ASK_CLI, then haiku.'
    )
    .option(
      '--max-context <chars>',
      'Maximum context size in characters (default: 100000)',
      (val) => parseInt(val, 10)
    )
    .action(async (query: string, options, command: Command) => {
      const container = requireContainer(command);

      await handleAskCommand(container, {
        query,
        limit: options.limit,
        domain: options.domain,
        collection: options.collection,
        model: options.model,
        maxContext: options.maxContext,
      });
    });

  return askCmd;
}
