/**
 * NotebookLM integration wrapper
 *
 * Provides best-effort integration with NotebookLM via Python child process.
 * Never throws errors - all failures return null and log to stderr.
 *
 * Requirements:
 * - python3 installed and in PATH
 * - notebooklm package installed: `pip install notebooklm`
 * - User authenticated: `notebooklm login`
 *
 * Architecture:
 * - Spawns scripts/notebooklm_add_urls.py as child process
 * - Communicates via JSON over stdin/stdout
 * - Python script uses two-phase approach (add, then wait)
 *
 * @module utils/notebooklm
 */

import { spawn, execSync } from 'child_process';
import { readFileSync } from 'fs';

/**
 * Find the Python interpreter that has notebooklm installed.
 *
 * Resolution order:
 * 1. Read shebang from `which notebooklm` to find the pipx venv Python
 * 2. Fall back to `python3`
 */
function findPython(): string {
  try {
    const notebookBin = execSync('which notebooklm', {
      encoding: 'utf-8',
    }).trim();
    const shebang = readFileSync(notebookBin, 'utf-8').split('\n')[0];
    if (shebang.startsWith('#!') && shebang.includes('python')) {
      return shebang.slice(2).trim();
    }
  } catch {
    // notebooklm CLI not found or shebang unreadable
  }
  return 'python3';
}

export interface NotebookResult {
  notebook_id: string;
  notebook_title: string;
  added: number;
  failed: number;
  errors: string[];
}

/**
 * Add URLs to a NotebookLM notebook (best-effort, never throws)
 *
 * Shells out to Python script that uses the notebooklm library.
 * If the notebook target is an ID, adds to existing notebook.
 * If the notebook target is a name, creates a new notebook.
 *
 * Uses two-phase approach per library docs:
 * 1. Sequential add_url(wait=False) - queue all URLs
 * 2. Batch wait_for_sources() - poll all in parallel
 *
 * @param notebookTarget - Notebook ID or name
 * @param urls - List of URLs to add as sources
 * @returns NotebookResult on success, null on any failure
 */
export async function addUrlsToNotebook(
  notebookTarget: string,
  urls: string[]
): Promise<NotebookResult | null> {
  return new Promise((resolve) => {
    const pythonBin = findPython();
    const child = spawn(pythonBin, ['scripts/notebooklm_add_urls.py'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const payload = JSON.stringify({
      notebook: notebookTarget,
      urls,
    });

    child.stdin.write(payload);
    child.stdin.end();

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Collect stderr for debugging
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Handle process exit
    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[NotebookLM] Script failed with code ${code}`);
        if (stderr) {
          console.error(`[NotebookLM] ${stderr}`);
        }
        resolve(null);
        return;
      }

      try {
        const result = JSON.parse(stdout) as NotebookResult;
        resolve(result);
      } catch {
        console.error('[NotebookLM] Failed to parse script output');
        resolve(null);
      }
    });

    // Handle spawn errors (e.g., python3 not found)
    child.on('error', (error) => {
      console.error(
        `[NotebookLM] Failed to spawn Python script: ${error.message}`
      );
      resolve(null);
    });
  });
}
