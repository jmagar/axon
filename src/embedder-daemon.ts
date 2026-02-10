/**
 * Embedder daemon entry point
 *
 * Runs as a background process to handle async embedding jobs.
 */

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createDaemonContainer } from './container/DaemonContainerFactory';
import { startEmbedderDaemon } from './utils/background-embedder';
import { fmt } from './utils/theme';

// Load .env from the CLI project directory, not the current working directory
const envPath = resolve(__dirname, '..', '.env');
loadDotenv({ path: envPath });

// Create daemon container
const container = createDaemonContainer();

// Start daemon and store cleanup function
let cleanup: (() => Promise<void>) | undefined;

// Start daemon with proper error handling
(async () => {
  try {
    cleanup = await startEmbedderDaemon(container);
  } catch (error) {
    console.error(
      fmt.error(
        `[Embedder] Fatal error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }
})();

// Handle graceful shutdown
const CLEANUP_TIMEOUT_MS = 5000;

async function gracefulShutdown(signal: string): Promise<void> {
  console.error(
    fmt.dim(`[Embedder] Received ${signal}, shutting down gracefully`)
  );

  if (!cleanup) {
    console.error(
      fmt.warning(
        '[Embedder] Cleanup function not yet initialized - daemon may still be starting'
      )
    );
    await container.dispose();
    process.exit(0);
  }

  try {
    // Race cleanup against timeout
    await Promise.race([
      cleanup(),
      new Promise<void>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Cleanup timed out after ${CLEANUP_TIMEOUT_MS}ms`)
            ),
          CLEANUP_TIMEOUT_MS
        )
      ),
    ]);
    await container.dispose();
    process.exit(0);
  } catch (error) {
    console.error(fmt.error(`[Embedder] Cleanup error: ${error}`));
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await gracefulShutdown('SIGTERM');
});

process.on('SIGINT', async () => {
  await gracefulShutdown('SIGINT');
});
