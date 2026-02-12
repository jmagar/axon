import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, rm, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import packageJson from '../../package.json';
import type { IContainer } from '../container/types';
import type {
  DoctorCheck,
  DoctorCheckStatus,
  DoctorOptions,
  DoctorOverallStatus,
  DoctorReport,
  DoctorSummaryCounts,
} from '../types/doctor';
import { sanitizeUrlCredentials } from '../utils/api-key-scrubber';
import { getAuthSource } from '../utils/auth';
import { formatJson, writeCommandOutput } from '../utils/command';
import {
  getCredentialsPath,
  getEmbedQueueDir,
  getJobHistoryPath,
  getSettingsPath,
  getStorageRoot,
} from '../utils/storage-paths';
import {
  colorize,
  colors,
  fmt,
  getStatusColor,
  getStatusIcon,
  icons,
} from '../utils/theme';
import {
  hasDoctorDebugBackendConfigured,
  runDoctorDebugChat,
} from './doctor-debug';
import { requireContainer, requireContainerFromCommandTree } from './shared';

type ComposePublisher = {
  TargetPort?: number;
  PublishedPort?: number;
  Protocol?: string;
};

type ComposePsEntry = {
  Name?: string;
  Service?: string;
  State?: string;
  Status?: string;
  Health?: string;
  Publishers?: ComposePublisher[];
};

type ParsedServiceEndpoint = {
  source: string;
  protocol: string;
  host: string;
  port: number;
  path?: string;
  raw: string;
};

type ResolvedEndpoint = {
  endpoint: ParsedServiceEndpoint;
  resolvedHost: string;
  resolvedPort: number;
  resolvedUrl?: string;
  resolution: 'as-is' | 'compose-published-port' | 'host-unreachable';
  reason?: string;
};

const DEFAULT_TIMEOUT_MS = 3000;

const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
  redis: 6379,
  amqp: 5672,
  postgres: 5432,
  tcp: 0,
};

function summarizeCounts(checks: DoctorCheck[]): DoctorSummaryCounts {
  const summary: DoctorSummaryCounts = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) {
    summary[check.status] += 1;
  }
  return summary;
}

function summarizeOverall(summary: DoctorSummaryCounts): DoctorOverallStatus {
  if (summary.fail > 0) return 'failed';
  if (summary.warn > 0) return 'degraded';
  return 'ok';
}

function parseComposePsJson(raw: string): ComposePsEntry[] {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: ComposePsEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as ComposePsEntry);
    } catch {
      // ignore malformed lines to avoid failing the whole doctor command
    }
  }
  return entries;
}

function buildPortMap(
  entries: ComposePsEntry[]
): Map<string, Map<number, number>> {
  const map = new Map<string, Map<number, number>>();

  for (const entry of entries) {
    if (!entry.Service) continue;
    const byTarget = new Map<number, number>();
    const publishers = entry.Publishers ?? [];
    for (const pub of publishers) {
      if (
        typeof pub.TargetPort === 'number' &&
        typeof pub.PublishedPort === 'number' &&
        pub.PublishedPort > 0
      ) {
        byTarget.set(pub.TargetPort, pub.PublishedPort);
      }
    }
    map.set(entry.Service, byTarget);
  }

  return map;
}

function parseServiceUrl(
  source: string,
  raw: string
): ParsedServiceEndpoint | null {
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.replace(':', '');
    const defaultPort = DEFAULT_PORTS[protocol] ?? 0;
    const port = parsed.port ? Number(parsed.port) : defaultPort;
    if (!parsed.hostname || !port) return null;
    return {
      source,
      protocol,
      host: parsed.hostname,
      port,
      path: parsed.pathname || '/',
      raw,
    };
  } catch {
    return null;
  }
}

function resolveEndpoint(
  endpoint: ParsedServiceEndpoint,
  portMap: Map<string, Map<number, number>>
): ResolvedEndpoint {
  const servicePorts = portMap.get(endpoint.host);
  if (!servicePorts) {
    return {
      endpoint,
      resolvedHost: endpoint.host,
      resolvedPort: endpoint.port,
      resolvedUrl: endpoint.raw,
      resolution: 'as-is',
    };
  }

  const publishedPort = servicePorts.get(endpoint.port);
  if (!publishedPort) {
    return {
      endpoint,
      resolvedHost: 'localhost',
      resolvedPort: endpoint.port,
      resolution: 'host-unreachable',
      reason: `No published port for ${endpoint.host}:${endpoint.port}`,
    };
  }

  let resolvedUrl: string | undefined;
  if (endpoint.protocol === 'http' || endpoint.protocol === 'https') {
    const cloned = new URL(endpoint.raw);
    cloned.hostname = 'localhost';
    cloned.port = String(publishedPort);
    resolvedUrl = cloned.toString();
  }

  return {
    endpoint,
    resolvedHost: 'localhost',
    resolvedPort: publishedPort,
    resolvedUrl,
    resolution: 'compose-published-port',
  };
}

async function runHttpCheck(
  url: string,
  timeoutMs: number
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runTcpCheck(
  host: string,
  port: number,
  timeoutMs: number
): Promise<{ ok: boolean; error?: string }> {
  return await new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () =>
      finish({ ok: false, error: `Connection timed out after ${timeoutMs}ms` })
    );
    socket.once('error', (error) =>
      finish({ ok: false, error: error.message })
    );
    socket.connect(port, host);
  });
}

function pickDockerProbeContainer(
  entries: ComposePsEntry[]
): string | undefined {
  const running = entries.filter(
    (entry) => (entry.State || '').toLowerCase() === 'running' && entry.Name
  );
  if (running.length === 0) return undefined;

  const preferred =
    running.find((entry) => entry.Service === 'firecrawl') ||
    running.find((entry) => entry.Service === 'firecrawl-embedder') ||
    running[0];

  return preferred.Name;
}

async function runDockerNetworkTcpCheck(
  probeContainer: string,
  host: string,
  port: number,
  timeoutMs: number
): Promise<{ ok: boolean; error?: string }> {
  const script =
    `const net=require('node:net');` +
    `const host=process.argv[1];` +
    `const port=Number.parseInt(process.argv[2],10);` +
    `const timeout=Number.parseInt(process.argv[3],10);` +
    `const s=net.createConnection({host,port});` +
    `let done=false;` +
    `function finish(code,msg){if(done)return;done=true;s.destroy();if(msg)console.error(msg);process.exit(code);}` +
    `s.setTimeout(timeout,()=>finish(1,\`timeout after \${timeout}ms\`));` +
    `s.on('connect',()=>finish(0));` +
    `s.on('error',(e)=>finish(1,e.message));`;

  return await new Promise((resolve) => {
    execFile(
      'docker',
      [
        'exec',
        probeContainer,
        'node',
        '-e',
        script,
        host,
        String(port),
        String(timeoutMs),
      ],
      { timeout: timeoutMs + 1500 },
      (error, _stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            error:
              stderr?.trim() ||
              (error instanceof Error ? error.message : String(error)),
          });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

async function checkWritableDirectory(
  path: string
): Promise<{ ok: boolean; error?: string }> {
  if (!existsSync(path)) {
    return { ok: false, error: 'Directory does not exist' };
  }

  try {
    await access(path);
    const probeFile = join(path, `.doctor-write-test-${randomUUID()}`);
    await writeFile(probeFile, 'ok', 'utf-8');
    await rm(probeFile, { force: true });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runContainerWriteProbe(
  containerName: string,
  containerPath: string,
  timeoutMs: number
): Promise<{ ok: boolean; error?: string }> {
  // Note: randomUUID() is called in Node.js context, not in container
  // Container only needs POSIX sh (touch, rm), no Node.js required
  const probeFile = `${containerPath}/.doctor-write-test-${randomUUID()}`;
  const shellCmd = `touch "${probeFile}" && rm -f "${probeFile}"`;

  return await new Promise((resolve) => {
    execFile(
      'docker',
      ['exec', containerName, 'sh', '-lc', shellCmd],
      { timeout: timeoutMs + 1500 },
      (error, _stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            error:
              stderr?.trim() ||
              (error instanceof Error ? error.message : String(error)),
          });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

function findComposeServiceContainerName(
  entries: ComposePsEntry[],
  serviceName: string
): string | undefined {
  return entries.find((entry) => entry.Service === serviceName)?.Name;
}

function getConfiguredCliModel(): string | undefined {
  const value = process.env.ASK_CLI?.trim();
  return value && value.length > 0 ? value : undefined;
}

async function getCliVersion(
  cli: string,
  timeoutMs: number
): Promise<{ ok: boolean; version?: string; error?: string }> {
  return await new Promise((resolve) => {
    // Use --help instead of --version for more robust detection
    // Claude CLI has distinct help output; version may not be available
    execFile(
      cli,
      ['--help'],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        const out = stdout.trim();
        const err = stderr.trim();

        if (error) {
          const details = err || out || error.message;
          resolve({ ok: false, error: details });
          return;
        }

        // Verify it's actually the expected CLI by checking help output
        const output = out || err;
        const isValidClaude =
          cli === 'claude' &&
          (output.includes('Anthropic') ||
            output.includes('claude') ||
            output.includes('conversation'));
        const isValidGemini =
          cli === 'gemini' &&
          (output.includes('Google') ||
            output.includes('gemini') ||
            output.includes('Gemini'));

        if (
          (cli === 'claude' && !isValidClaude) ||
          (cli === 'gemini' && !isValidGemini)
        ) {
          resolve({
            ok: false,
            error: `Binary '${cli}' found but does not appear to be the correct CLI tool`,
          });
          return;
        }

        // Try to extract version from help output or indicate CLI is valid
        const versionMatch = output.match(/version[:\s]+([0-9.]+)/i);
        resolve({
          ok: true,
          version: versionMatch ? versionMatch[1] : 'CLI detected and verified',
        });
      }
    );
  });
}

function printHumanReport(report: DoctorReport): void {
  const heading = (text: string): string =>
    fmt.bold(colorize(colors.primary, text));
  const toStatusWord = (status: DoctorCheckStatus): string =>
    status === 'pass' ? 'completed' : status === 'warn' ? 'pending' : 'failed';
  const shouldAccentCheckName = (category: DoctorCheck['category']): boolean =>
    category === 'docker' ||
    category === 'services' ||
    category === 'directories' ||
    category === 'config_files';

  console.log('');
  console.log(
    `  ${fmt.primary(`${icons.success} firecrawl`)} ${fmt.dim('cli')} ${fmt.dim(`v${packageJson.version}`)}`
  );
  console.log('');
  const overallWord =
    report.overallStatus === 'ok'
      ? 'completed'
      : report.overallStatus === 'degraded'
        ? 'pending'
        : 'failed';
  const overallColor = getStatusColor(overallWord);
  const overallIcon = getStatusIcon(overallWord);
  console.log(
    `  ${colorize(overallColor, overallIcon)} doctor ${colorize(overallColor, report.overallStatus)} ${fmt.dim(`(pass ${report.summary.pass} | warn ${report.summary.warn} | fail ${report.summary.fail})`)}`
  );
  console.log('');

  for (const category of [
    'docker',
    'services',
    'directories',
    'ai_cli',
    'config_files',
  ] as const) {
    const checks = report.checks.filter((check) => check.category === category);
    if (checks.length === 0) continue;
    console.log(`  ${heading(category.replace('_', ' ').toUpperCase())}`);
    for (const check of checks) {
      const statusWord = toStatusWord(check.status);
      const statusColor = getStatusColor(statusWord);
      const icon = getStatusIcon(statusWord);
      const checkName = shouldAccentCheckName(check.category)
        ? colorize(colors.materialLightBlue, check.name)
        : check.name;
      console.log(
        `    ${colorize(statusColor, icon)} ${checkName} ${colorize(statusColor, statusWord)} ${fmt.dim(`(${check.message})`)}`
      );
    }
    console.log('');
  }

  if (report.summary.fail > 0) {
    if (hasDoctorDebugBackendConfigured()) {
      console.log(
        `  ${fmt.warning(icons.active)} ${fmt.bold('Troubleshooting:')} run ${fmt.primary('firecrawl doctor debug')}`
      );
      console.log('');
    } else {
      console.log(
        `  ${fmt.warning(icons.active)} ${fmt.bold('Troubleshooting:')} configure ${fmt.primary('ASK_CLI')} or ${fmt.primary('OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL')} to enable doctor debug`
      );
      console.log('');
    }
  }
}

async function collectDockerChecks(timeoutMs: number): Promise<{
  checks: DoctorCheck[];
  entries: ComposePsEntry[];
  portMap: Map<string, Map<number, number>>;
}> {
  const checks: DoctorCheck[] = [];

  try {
    const { stdout } = await new Promise<{ stdout: string }>(
      (resolve, reject) => {
        execFile(
          'docker',
          ['compose', 'ps', '--format', 'json'],
          { timeout: timeoutMs },
          (error, stdoutText) => {
            if (error) {
              reject(error);
              return;
            }
            resolve({ stdout: stdoutText });
          }
        );
      }
    );

    const entries = parseComposePsJson(stdout);
    if (entries.length === 0) {
      checks.push({
        category: 'docker',
        name: 'docker-compose',
        status: 'warn',
        message: 'No compose services detected',
      });
      return { checks, entries, portMap: new Map() };
    }

    for (const entry of entries) {
      const name = entry.Service || entry.Name || 'unknown-service';
      const state = (entry.State || '').toLowerCase();
      const health = (entry.Health || '').toLowerCase();
      let status: DoctorCheckStatus = 'pass';
      let message = entry.Status || 'Unknown';

      if (state !== 'running') {
        status = 'fail';
        message = `Container state is ${entry.State || 'unknown'}`;
      } else if (health === 'unhealthy') {
        status = 'fail';
        message = `Container is unhealthy (${entry.Status || 'unknown'})`;
      } else if (!health) {
        status = 'warn';
        message = `Container running without healthcheck (${entry.Status || 'unknown'})`;
      } else {
        message = `Container running (${health})`;
      }

      checks.push({
        category: 'docker',
        name,
        status,
        message,
        details: {
          state: entry.State,
          health: entry.Health,
          status: entry.Status,
        },
      });
    }

    return { checks, entries, portMap: buildPortMap(entries) };
  } catch (error) {
    checks.push({
      category: 'docker',
      name: 'docker-compose',
      status: 'warn',
      message: `Unable to inspect docker compose services: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { checks, entries: [], portMap: new Map() };
  }
}

function buildServiceEndpointInputs(
  container: IContainer
): Array<{ key: string; raw: string }> {
  const items: Array<{ key: string; raw: string | undefined }> = [
    {
      key: 'FIRECRAWL_API_URL',
      raw: container.config.apiUrl || process.env.FIRECRAWL_API_URL,
    },
    { key: 'TEI_URL', raw: container.config.teiUrl || process.env.TEI_URL },
    {
      key: 'QDRANT_URL',
      raw: container.config.qdrantUrl || process.env.QDRANT_URL,
    },
    {
      key: 'FIRECRAWL_EMBEDDER_WEBHOOK_URL',
      raw:
        container.config.embedderWebhookUrl ||
        process.env.FIRECRAWL_EMBEDDER_WEBHOOK_URL,
    },
    {
      key: 'PLAYWRIGHT_MICROSERVICE_URL',
      raw: process.env.PLAYWRIGHT_MICROSERVICE_URL,
    },
    { key: 'REDIS_URL', raw: process.env.REDIS_URL },
    { key: 'REDIS_RATE_LIMIT_URL', raw: process.env.REDIS_RATE_LIMIT_URL },
    { key: 'NUQ_RABBITMQ_URL', raw: process.env.NUQ_RABBITMQ_URL },
  ];

  if (process.env.POSTGRES_HOST && process.env.POSTGRES_PORT) {
    items.push({
      key: 'POSTGRES_URL',
      raw: `postgres://${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}`,
    });
  }

  return items
    .filter((item) => item.raw && item.raw.trim().length > 0)
    .map((item) => ({ key: item.key, raw: item.raw?.trim() ?? '' }));
}

async function collectServiceChecks(
  container: IContainer,
  composeEntries: ComposePsEntry[],
  portMap: Map<string, Map<number, number>>,
  timeoutMs: number
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const endpoints = buildServiceEndpointInputs(container);
  const probeContainer = pickDockerProbeContainer(composeEntries);

  if (endpoints.length === 0) {
    checks.push({
      category: 'services',
      name: 'service-endpoints',
      status: 'warn',
      message: 'No configured service URLs found',
    });
    return checks;
  }

  for (const input of endpoints) {
    const parsed = parseServiceUrl(input.key, input.raw);
    if (!parsed) {
      checks.push({
        category: 'services',
        name: input.key,
        status: 'fail',
        message: 'Invalid service URL',
        details: { raw: sanitizeUrlCredentials(input.raw) },
      });
      continue;
    }

    const resolved = resolveEndpoint(parsed, portMap);
    if (resolved.resolution === 'host-unreachable') {
      if (probeContainer) {
        const networkCheck = await runDockerNetworkTcpCheck(
          probeContainer,
          parsed.host,
          parsed.port,
          timeoutMs
        );
        checks.push({
          category: 'services',
          name: input.key,
          status: networkCheck.ok ? 'pass' : 'fail',
          message: networkCheck.ok
            ? `Reachable via docker network (${probeContainer} -> ${parsed.host}:${parsed.port})`
            : `Unreachable from host and docker network (${networkCheck.error || 'Unknown error'})`,
          details: {
            raw: sanitizeUrlCredentials(parsed.raw),
            host: parsed.host,
            port: parsed.port,
            resolution: resolved.resolution,
            probeContainer,
          },
        });
        continue;
      }

      checks.push({
        category: 'services',
        name: input.key,
        status: 'fail',
        message: resolved.reason || 'Service URL not reachable from host',
        details: {
          raw: sanitizeUrlCredentials(parsed.raw),
          host: parsed.host,
          port: parsed.port,
        },
      });
      continue;
    }

    if (parsed.protocol === 'http' || parsed.protocol === 'https') {
      const check = await runHttpCheck(
        resolved.resolvedUrl || parsed.raw,
        timeoutMs
      );
      checks.push({
        category: 'services',
        name: input.key,
        status: check.ok ? 'pass' : 'fail',
        message: check.ok
          ? `Reachable (${check.status})`
          : `Unreachable (${check.error || 'Unknown error'})`,
        details: {
          raw: sanitizeUrlCredentials(parsed.raw),
          checked: sanitizeUrlCredentials(resolved.resolvedUrl || parsed.raw),
          resolution: resolved.resolution,
        },
      });
      continue;
    }

    const tcp = await runTcpCheck(
      resolved.resolvedHost,
      resolved.resolvedPort,
      timeoutMs
    );
    checks.push({
      category: 'services',
      name: input.key,
      status: tcp.ok ? 'pass' : 'fail',
      message: tcp.ok
        ? `TCP reachable (${resolved.resolvedHost}:${resolved.resolvedPort})`
        : `TCP unreachable (${tcp.error || 'Unknown error'})`,
      details: {
        raw: sanitizeUrlCredentials(parsed.raw),
        checkedHost: resolved.resolvedHost,
        checkedPort: resolved.resolvedPort,
        resolution: resolved.resolution,
      },
    });
  }

  return checks;
}

async function collectDirectoryChecks(
  composeEntries: ComposePsEntry[],
  timeoutMs: number
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const directories: Array<{ name: string; path: string | undefined }> = [
    { name: 'FIRECRAWL_HOME', path: getStorageRoot() },
    { name: 'FIRECRAWL_EMBEDDER_QUEUE_DIR', path: getEmbedQueueDir() },
    { name: 'QDRANT_DATA_DIR', path: process.env.QDRANT_DATA_DIR },
  ];

  for (const directory of directories) {
    if (!directory.path) {
      checks.push({
        category: 'directories',
        name: directory.name,
        status: 'warn',
        message: 'Path not configured',
      });
      continue;
    }

    const result = await checkWritableDirectory(directory.path);
    if (
      directory.name === 'QDRANT_DATA_DIR' &&
      !result.ok &&
      (result.error || '').includes('EACCES')
    ) {
      const qdrantContainer = findComposeServiceContainerName(
        composeEntries,
        'firecrawl-qdrant'
      );
      if (qdrantContainer) {
        const containerProbe = await runContainerWriteProbe(
          qdrantContainer,
          '/qdrant/storage',
          timeoutMs
        );
        if (containerProbe.ok) {
          checks.push({
            category: 'directories',
            name: directory.name,
            status: 'pass',
            message: `Writable via container (${qdrantContainer}:/qdrant/storage); host user lacks write permission`,
            details: { path: directory.path, container: qdrantContainer },
          });
          continue;
        }
      }
    }

    checks.push({
      category: 'directories',
      name: directory.name,
      status: result.ok ? 'pass' : 'fail',
      message: result.ok
        ? 'Writable'
        : `Not writable (${result.error || 'Unknown error'})`,
      details: { path: directory.path },
    });
  }

  return checks;
}

function collectConfigFileChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const authSource = getAuthSource();
  const files = [
    { name: 'FIRECRAWL_HOME', path: getStorageRoot(), type: 'directory' },
    { name: 'credentials.json', path: getCredentialsPath(), type: 'file' },
    { name: 'settings.json', path: getSettingsPath(), type: 'file' },
    { name: 'job-history.json', path: getJobHistoryPath(), type: 'file' },
  ];

  // Optional files that are created on-demand
  const optionalFiles = ['settings.json', 'job-history.json'];

  for (const file of files) {
    const exists = existsSync(file.path);
    const isOptional = optionalFiles.includes(file.name);

    if (file.name === 'credentials.json' && !exists) {
      const status: DoctorCheckStatus =
        authSource === 'stored' ? 'fail' : 'pass';
      const message =
        authSource === 'stored'
          ? 'Missing file (stored credentials expected)'
          : authSource === 'env'
            ? 'Not required (using FIRECRAWL_API_KEY)'
            : 'Optional (not using stored credentials)';
      checks.push({
        category: 'config_files',
        name: file.name,
        status,
        message,
        details: {
          path: file.path,
          parentDir: dirname(file.path),
          authSource,
        },
      });
      continue;
    }

    // Handle optional files differently - warn instead of fail when missing
    let status: DoctorCheckStatus;
    let message: string;

    if (!exists && isOptional) {
      status = 'warn';
      message = 'Optional (not yet created)';
    } else if (exists) {
      status = 'pass';
      message = 'Exists';
    } else {
      status = 'fail';
      message = `Missing ${file.type}`;
    }

    checks.push({
      category: 'config_files',
      name: file.name,
      status,
      message,
      details: {
        path: file.path,
        parentDir: dirname(file.path),
      },
    });
  }

  return checks;
}

async function collectAiChecks(timeoutMs: number): Promise<DoctorCheck[]> {
  const configuredCliModel = getConfiguredCliModel();
  if (configuredCliModel) {
    const cli = configuredCliModel.startsWith('gemini-') ? 'gemini' : 'claude';
    const version = await getCliVersion(cli, timeoutMs);
    return [
      {
        category: 'ai_cli',
        name: `${cli} (${configuredCliModel})`,
        status: version.ok ? 'pass' : 'fail',
        message: !version.ok
          ? `CLI not installed or not executable (${version.error || 'Unknown error'})`
          : `Installed (${version.version || 'version ok'})`,
        details: {
          backend: 'cli',
          cli,
          model: configuredCliModel,
          version: version.version,
        },
      },
    ];
  }

  const openAiBaseUrl = process.env.OPENAI_BASE_URL?.trim();
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const openAiModel = process.env.OPENAI_MODEL?.trim();
  const hasOpenAiFallback = Boolean(
    openAiBaseUrl && openAiApiKey && openAiModel
  );

  return [
    {
      category: 'ai_cli',
      name: hasOpenAiFallback
        ? `openai-compatible (${openAiModel})`
        : 'ai-debug-backend',
      status: hasOpenAiFallback ? 'pass' : 'warn',
      message: hasOpenAiFallback
        ? 'OpenAI-compatible fallback configured'
        : 'No ASK_CLI configured and OpenAI fallback is incomplete',
      details: {
        backend: hasOpenAiFallback ? 'openai' : 'none',
        askCliConfigured: false,
        openAiConfigured: hasOpenAiFallback,
      },
    },
  ];
}

export async function executeDoctor(
  container: IContainer,
  options: DoctorOptions = {}
): Promise<DoctorReport> {
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

  const docker = await collectDockerChecks(timeoutMs);
  const services = await collectServiceChecks(
    container,
    docker.entries,
    docker.portMap,
    timeoutMs
  );
  const directories = await collectDirectoryChecks(docker.entries, timeoutMs);
  const ai = await collectAiChecks(timeoutMs);
  const configFiles = collectConfigFileChecks();

  const checks = [
    ...docker.checks,
    ...services,
    ...directories,
    ...ai,
    ...configFiles,
  ];
  const summary = summarizeCounts(checks);

  return {
    timestamp: new Date().toISOString(),
    overallStatus: summarizeOverall(summary),
    summary,
    checks,
  };
}

export async function handleDoctorCommand(
  container: IContainer,
  options: DoctorOptions = {}
): Promise<void> {
  const report = await executeDoctor(container, options);
  if (options.json) {
    const payload = formatJson(report, options.pretty ?? false);
    writeCommandOutput(payload, options);
    return;
  }

  printHumanReport(report);
}

export async function handleDoctorDebugCommand(
  container: IContainer,
  options: { timeout?: number; aiTimeout?: number } = {}
): Promise<void> {
  const report = await executeDoctor(container, { timeout: options.timeout });
  await runDoctorDebugChat(report, { aiTimeout: options.aiTimeout });
}

export function createDoctorCommand(): Command {
  const doctorCommand = new Command('doctor')
    .description('Run local diagnostics for service health and configuration')
    .option('--json', 'Output JSON (compact)', false)
    .option('--pretty', 'Pretty print JSON output', false)
    .option(
      '--timeout <ms>',
      'Timeout for each probe in milliseconds',
      (value) => Number.parseInt(value, 10),
      DEFAULT_TIMEOUT_MS
    )
    .action(async (options, command: Command) => {
      const container = requireContainer(command);
      try {
        await handleDoctorCommand(container, {
          json: options.json,
          pretty: options.pretty,
          timeout: options.timeout,
        });
      } catch (error) {
        const failedReport: DoctorReport = {
          timestamp: new Date().toISOString(),
          overallStatus: 'failed',
          summary: { pass: 0, warn: 0, fail: 1 },
          checks: [
            {
              category: 'services',
              name: 'doctor',
              status: 'fail',
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        };
        if (options.json) {
          writeCommandOutput(
            formatJson(failedReport, options.pretty ?? false),
            {
              json: true,
              pretty: options.pretty,
            }
          );
          return;
        }
        printHumanReport(failedReport);
      }
    });

  doctorCommand
    .command('debug')
    .description(
      'Run doctor, then stream AI troubleshooting guidance (ASK_CLI or OpenAI fallback)'
    )
    .option(
      '--timeout <ms>',
      'Timeout for each doctor probe in milliseconds',
      (value) => Number.parseInt(value, 10),
      DEFAULT_TIMEOUT_MS
    )
    .option(
      '--ai-timeout <ms>',
      'Timeout for AI debug analysis in milliseconds',
      (value) => Number.parseInt(value, 10),
      120000
    )
    .action(async (options, command: Command) => {
      const container = requireContainerFromCommandTree(command);
      await handleDoctorDebugCommand(container, {
        timeout: options.timeout,
        aiTimeout: options.aiTimeout,
      });
    });

  return doctorCommand;
}

export const __doctorTestables = {
  parseComposePsJson,
  parseServiceUrl,
  resolveEndpoint,
};
