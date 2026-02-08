import type { Command } from 'commander';
import type { IContainer } from '../container/types';

interface CommandWithContainer extends Command {
  _container?: IContainer;
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
