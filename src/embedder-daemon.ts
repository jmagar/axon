/**
 * Embedder daemon entry point
 *
 * Runs as a background process to handle async embedding jobs.
 */

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { startEmbedderDaemon } from './utils/background-embedder';
import { initializeConfig } from './utils/config';

// Load .env from the CLI project directory, not the current working directory
const envPath = resolve(__dirname, '..', '.env');
loadDotenv({ path: envPath });

// Initialize config
initializeConfig();

// Start daemon
startEmbedderDaemon().catch((error) => {
  console.error('[Embedder] Fatal error:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.error('[Embedder] Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[Embedder] Received SIGINT, shutting down gracefully');
  process.exit(0);
});
