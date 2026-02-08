import type { Command } from 'commander';
import type { IContainer } from '../container/types';

interface CommandWithContainer extends Command {
  _container?: IContainer;
}

interface DomainSourceFilterOptions {
  domain?: string;
  source?: string;
}

export function requireContainer(command: Command): IContainer {
  const container = (command as CommandWithContainer)._container;
  if (!container) {
    throw new Error('Container not initialized');
  }
  return container;
}

export function requireContainerFromCommandTree(command: Command): IContainer {
  let current: Command | undefined = command;
  while (current) {
    const container = (current as CommandWithContainer)._container;
    if (container) {
      return container;
    }
    current = current.parent ?? undefined;
  }
  throw new Error('Container not initialized');
}

export function resolveCollectionName(
  container: IContainer,
  collection?: string
): string {
  return collection || container.config.qdrantCollection || 'firecrawl';
}

export function getQdrantUrlError(commandName: string): string {
  return `QDRANT_URL must be set in .env for the ${commandName} command.`;
}

export function buildDomainSourceFilter(
  options: DomainSourceFilterOptions
): Record<string, string | number | boolean> | undefined {
  const filter: Record<string, string | number | boolean> = {};
  if (options.domain) {
    filter.domain = options.domain;
  }
  if (options.source) {
    filter.source_command = options.source;
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
}

export function addDomainSourceFilterOptions(command: Command): Command {
  return command
    .option('--domain <domain>', 'Filter by domain')
    .option(
      '--source <command>',
      'Filter by source command (scrape, crawl, embed, search, extract)'
    );
}

export function addVectorOutputOptions(command: Command): Command {
  return command
    .option(
      '--collection <name>',
      'Qdrant collection name (default: firecrawl)'
    )
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON', false);
}
