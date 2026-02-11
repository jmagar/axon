import { spawn } from 'node:child_process';
import type { DoctorReport } from '../types/doctor';
import { colorize, colors, fmt } from '../utils/theme';

export interface DoctorDebugOptions {
  aiTimeout?: number;
}

const DEFAULT_AI_DEBUG_TIMEOUT_MS = 120000;

type DoctorDebugBackend =
  | {
      kind: 'cli';
      cli: 'gemini' | 'claude';
      model: string;
      label: string;
    }
  | {
      kind: 'openai';
      model: string;
      baseUrl: string;
      apiKey: string;
      label: string;
    };

function getConfiguredCliModel(): string | undefined {
  const value = process.env.ASK_CLI?.trim();
  return value && value.length > 0 ? value : undefined;
}

function getOpenAiFallbackConfig():
  | { baseUrl: string; apiKey: string; model: string }
  | undefined {
  const baseUrl = process.env.OPENAI_BASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) {
    return undefined;
  }
  return { baseUrl, apiKey, model };
}

function resolveDoctorDebugBackend(): DoctorDebugBackend | undefined {
  const cliModel = getConfiguredCliModel();
  if (cliModel) {
    const cli = cliModel.startsWith('gemini-') ? 'gemini' : 'claude';
    return {
      kind: 'cli',
      cli,
      model: cliModel,
      label: `${cli} (${cliModel})`,
    };
  }

  const openAi = getOpenAiFallbackConfig();
  if (openAi) {
    return {
      kind: 'openai',
      model: openAi.model,
      baseUrl: openAi.baseUrl,
      apiKey: openAi.apiKey,
      label: `openai-compatible (${openAi.model})`,
    };
  }

  return undefined;
}

export function hasDoctorDebugBackendConfigured(): boolean {
  return resolveDoctorDebugBackend() !== undefined;
}

function buildDoctorDebugPrompt(report: DoctorReport): string {
  const failing = report.checks.filter((check) => check.status === 'fail');
  const warning = report.checks.filter((check) => check.status === 'warn');
  const topIssues = [...failing, ...warning]
    .slice(0, 10)
    .map((check) => `- [${check.category}] ${check.name}: ${check.message}`)
    .join('\n');

  const reportJson = JSON.stringify(report, null, 2);
  return [
    'You are a Firecrawl CLI infrastructure troubleshooting assistant.',
    'Analyze this `firecrawl doctor` report and provide a practical fix plan.',
    'Return only the final answer. Do not narrate your internal process.',
    'Do not say things like "I will investigate" or "I am checking".',
    'Requirements:',
    '- Focus on root cause, not generic advice.',
    '- Prioritize fixes from highest impact first.',
    '- Give concrete shell commands for each fix.',
    '- Mention which issues are safe to ignore for local dev.',
    '- Keep output concise and actionable.',
    '- Use markdown and this exact structure with headings:',
    '## Root Cause',
    '## Fix Plan',
    '## Safe To Ignore (Local Dev)',
    '## Verify',
    '- In "Fix Plan", use numbered steps.',
    '- For shell commands, use fenced bash code blocks.',
    '- If a check is already healthy, explicitly say "No action needed".',
    '- Do not include any preamble or epilogue outside the headings.',
    '',
    'Doctor Summary:',
    `- overallStatus: ${report.overallStatus}`,
    `- pass: ${report.summary.pass}`,
    `- warn: ${report.summary.warn}`,
    `- fail: ${report.summary.fail}`,
    '',
    'Top Issues:',
    topIssues || '- none',
    '',
    'Full Doctor JSON:',
    reportJson,
  ].join('\n');
}

async function streamCliDebug(
  backend: Extract<DoctorDebugBackend, { kind: 'cli' }>,
  prompt: string,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const aiProcess = spawn(backend.cli, ['--model', backend.model], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderrOutput = '';

    const timer = setTimeout(() => {
      aiProcess.kill('SIGTERM');
      reject(
        new Error(
          `${backend.cli} debug analysis timed out after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    aiProcess.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk.toString());
    });

    aiProcess.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    aiProcess.on('error', (error: Error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Failed to launch ${backend.cli}: ${error.message}. Ensure it is installed and in PATH.`
        )
      );
    });

    aiProcess.on('close', (code: number) => {
      clearTimeout(timer);
      if (code !== 0) {
        const stderrSnippet = stderrOutput.trim();
        reject(
          new Error(
            `${backend.cli} exited with code ${code}${stderrSnippet ? `: ${stderrSnippet}` : ''}`
          )
        );
        return;
      }
      resolve();
    });

    aiProcess.stdin.write(prompt);
    aiProcess.stdin.end();
  });
}

function extractOpenAiText(payload: unknown): string | undefined {
  const root = payload as Record<string, unknown>;
  const choices = root.choices as Array<Record<string, unknown>> | undefined;
  const first = choices?.[0];
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }

  const outputText = root.output_text;
  if (typeof outputText === 'string' && outputText.trim().length > 0) {
    return outputText;
  }
  return undefined;
}

async function streamOpenAiDebug(
  backend: Extract<DoctorDebugBackend, { kind: 'openai' }>,
  prompt: string,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${backend.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const streamResponse = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${backend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: backend.model,
        temperature: 0.2,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!streamResponse.ok) {
      const errorBody = await streamResponse.text();
      throw new Error(
        `OpenAI fallback request failed (${streamResponse.status}): ${errorBody || streamResponse.statusText}`
      );
    }

    const contentType = streamResponse.headers.get('content-type') || '';
    if (
      streamResponse.body &&
      contentType.toLowerCase().includes('text/event-stream')
    ) {
      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let wroteAnyOutput = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const eventPayload = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = eventPayload.choices?.[0]?.delta?.content;
            if (token && token.length > 0) {
              wroteAnyOutput = true;
              process.stdout.write(token);
            }
          } catch {
            // ignore malformed SSE frames from non-standard providers
          }
        }
      }

      if (wroteAnyOutput) {
        return;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${backend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: backend.model,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenAI fallback request failed (${response.status}): ${errorBody || response.statusText}`
      );
    }

    const payload = (await response.json()) as unknown;
    const text = extractOpenAiText(payload);
    if (!text) {
      throw new Error('OpenAI fallback returned no text content');
    }
    process.stdout.write(text);
  } finally {
    clearTimeout(timer);
  }
}

export async function runDoctorDebugChat(
  report: DoctorReport,
  options: DoctorDebugOptions = {}
): Promise<void> {
  const backend = resolveDoctorDebugBackend();
  if (!backend) {
    throw new Error(
      'No AI backend configured. Set ASK_CLI, or configure OPENAI_BASE_URL + OPENAI_API_KEY + OPENAI_MODEL.'
    );
  }

  const speaker =
    backend.kind === 'cli'
      ? backend.cli === 'gemini'
        ? 'Gemini'
        : 'Claude'
      : 'Assistant';
  const prompt = buildDoctorDebugPrompt(report);

  console.log('');
  console.log(`  ${fmt.bold(colorize(colors.primary, 'Doctor Debug Chat'))}`);
  console.log(`  ${fmt.dim(`Model: ${backend.label}`)}`);
  console.log(
    `  ${fmt.dim(`Summary: pass ${report.summary.pass} | warn ${report.summary.warn} | fail ${report.summary.fail}`)}`
  );
  console.log('');
  console.log(
    `  ${fmt.primary('You:')} Diagnose and fix my Firecrawl setup issues.`
  );
  console.log('');
  console.log(`  ${fmt.primary(`${speaker}:`)}`);
  console.log('');

  const timeoutMs = options.aiTimeout ?? DEFAULT_AI_DEBUG_TIMEOUT_MS;
  if (backend.kind === 'cli') {
    await streamCliDebug(backend, prompt, timeoutMs);
  } else {
    await streamOpenAiDebug(backend, prompt, timeoutMs);
  }
  console.log('');
}
