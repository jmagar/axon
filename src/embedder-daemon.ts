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
startEmbedderDaemon(container)
  .then((cleanupFn) => {
    cleanup = cleanupFn;
  })
  .catch((error) => {
    console.error(
      fmt.error(
        `[Embedder] Fatal error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  });

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.error(
    fmt.dim('[Embedder] Received SIGTERM, shutting down gracefully')
  );
  try {
    await cleanup?.();
    await container.dispose();
    process.exit(0);
  } catch (error) {
    console.error(fmt.error(`[Embedder] Cleanup error: ${error}`));
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.error(
    fmt.dim('[Embedder] Received SIGINT, shutting down gracefully')
  );
  try {
    await cleanup?.();
    await container.dispose();
    process.exit(0);
  } catch (error) {
    console.error(fmt.error(`[Embedder] Cleanup error: ${error}`));
    process.exit(1);
  }
});
