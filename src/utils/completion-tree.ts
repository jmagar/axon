/**
 * Completion tree definition for firecrawl CLI
 *
 * Defines all commands, subcommands, and their options for shell completion.
 * This tree is used by omelette to provide tab completion in bash, zsh, and fish.
 */

/**
 * Completion tree structure
 *
 * Each command can have:
 * - options: Map of option flags to their completion values
 *   - Arrays: Predefined values for completion
 *   - '<type>': Placeholder indicating free-form input (no completion)
 *   - []: Flag with no value
 * - subcommands: Nested commands with their own options
 */
export const completionTree = {
  scrape: {
    options: {
      '-u': '<url>',
      '--url': '<url>',
      '-H': [],
      '--html': [],
      '-f': [
        'markdown',
        'html',
        'rawHtml',
        'links',
        'images',
        'screenshot',
        'summary',
        'changeTracking',
        'json',
        'attributes',
        'branding',
      ],
      '--format': [
        'markdown',
        'html',
        'rawHtml',
        'links',
        'images',
        'screenshot',
        'summary',
        'changeTracking',
        'json',
        'attributes',
        'branding',
      ],
      '--only-main-content': [],
      '--no-only-main-content': [],
      '--wait-for': '<ms>',
      '--timeout': '<seconds>',
      '--screenshot': [],
      '--include-tags': '<tags>',
      '--exclude-tags': '<tags>',
      '-k': '<key>',
      '--api-key': '<key>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
      '--timing': [],
      '--no-embed': [],
      '--remove': [],
    },
  },

  crawl: {
    options: {
      '-u': '<url>',
      '--url': '<url>',
      '--wait': [],
      '--poll-interval': '<seconds>',
      '--timeout': '<seconds>',
      '--progress': [],
      '--limit': '<number>',
      '--max-depth': '<number>',
      '--exclude-paths': '<paths>',
      '--include-paths': '<paths>',
      '--sitemap': ['skip', 'include'],
      '--ignore-query-parameters': [],
      '--no-ignore-query-parameters': [],
      '--crawl-entire-domain': [],
      '--allow-external-links': [],
      '--allow-subdomains': [],
      '--no-allow-subdomains': [],
      '--only-main-content': [],
      '--no-only-main-content': [],
      '--exclude-tags': '<tags>',
      '--include-tags': '<tags>',
      '--delay': '<ms>',
      '--max-concurrency': '<number>',
      '-k': '<key>',
      '--api-key': '<key>',
      '-o': '<file>',
      '--output': '<file>',
      '--pretty': [],
      '--embed': [],
      '--no-embed': [],
      '--no-default-excludes': [],
    },
    subcommands: {
      status: {
        options: {
          '-o': '<file>',
          '--output': '<file>',
          '--pretty': [],
        },
      },
      cancel: {
        options: {
          '-o': '<file>',
          '--output': '<file>',
          '--pretty': [],
        },
      },
      errors: {
        options: {
          '-o': '<file>',
          '--output': '<file>',
          '--pretty': [],
        },
      },
    },
  },

  map: {
    options: {
      '-u': '<url>',
      '--url': '<url>',
      '--search': '<query>',
      '--ignore-sitemap': [],
      '--include-subdomains': [],
      '--limit': '<number>',
      '-k': '<key>',
      '--api-key': '<key>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  search: {
    options: {
      '-q': '<query>',
      '--query': '<query>',
      '--limit': '<number>',
      '--lang': '<language>',
      '--country': '<country>',
      '--search-mode': ['fast', 'accurate'],
      '--scrape-mode': ['none', 'auto', 'always'],
      '--format': [
        'markdown',
        'html',
        'rawHtml',
        'links',
        'images',
        'screenshot',
      ],
      '-k': '<key>',
      '--api-key': '<key>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
      '--no-embed': [],
    },
  },

  extract: {
    options: {
      '-u': '<url>',
      '--url': '<url>',
      '--prompt': '<prompt>',
      '--schema': '<json>',
      '--wait': [],
      '--poll-interval': '<seconds>',
      '--timeout': '<seconds>',
      '--format': ['markdown', 'html', 'rawHtml', 'links', 'screenshot'],
      '--only-main-content': [],
      '--no-only-main-content': [],
      '-k': '<key>',
      '--api-key': '<key>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
      '--no-embed': [],
    },
    subcommands: {
      status: {
        options: {
          '-o': '<file>',
          '--output': '<file>',
          '--pretty': [],
        },
      },
    },
  },

  batch: {
    options: {
      '--wait': [],
      '--poll-interval': '<seconds>',
      '--timeout': '<seconds>',
      '--format': [
        'markdown',
        'html',
        'rawHtml',
        'links',
        'images',
        'screenshot',
      ],
      '--only-main-content': [],
      '--wait-for': '<ms>',
      '--screenshot': [],
      '--include-tags': '<tags>',
      '--exclude-tags': '<tags>',
      '--max-concurrency': '<number>',
      '--ignore-invalid-urls': [],
      '--webhook': '<url>',
      '--zero-data-retention': [],
      '--idempotency-key': '<key>',
      '--append-to-id': '<id>',
      '--integration': '<name>',
      '-k': '<key>',
      '--api-key': '<key>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
    subcommands: {
      status: {
        options: {
          '-o': '<file>',
          '--output': '<file>',
          '--json': [],
          '--pretty': [],
        },
      },
      cancel: {
        options: {
          '-o': '<file>',
          '--output': '<file>',
          '--json': [],
          '--pretty': [],
        },
      },
      errors: {
        options: {
          '-o': '<file>',
          '--output': '<file>',
          '--json': [],
          '--pretty': [],
        },
      },
    },
  },

  embed: {
    options: {
      '--collection': '<name>',
      '-k': '<key>',
      '--api-key': '<key>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  query: {
    options: {
      '-q': '<query>',
      '--query': '<query>',
      '--collection': '<name>',
      '--limit': '<number>',
      '--threshold': '<number>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  retrieve: {
    options: {
      '--collection': '<name>',
      '--filter': '<json>',
      '--limit': '<number>',
      '--offset': '<number>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  list: {
    options: {
      '--format': ['table', 'json'],
      '--status': ['completed', 'scraping', 'failed', 'cancelled'],
      '--limit': '<number>',
      '-o': '<file>',
      '--output': '<file>',
      '--pretty': [],
    },
  },

  status: {
    options: {
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  config: {
    options: {
      '--api-key': '<key>',
      '--api-url': '<url>',
      '--tei-url': '<url>',
      '--qdrant-url': '<url>',
      '--qdrant-collection': '<name>',
      '--show': [],
    },
  },

  'view-config': {
    options: {
      '--json': [],
      '--pretty': [],
    },
  },

  login: {
    options: {
      '-k': '<key>',
      '--api-key': '<key>',
    },
  },

  logout: {
    options: {},
  },

  version: {
    options: {},
  },

  sources: {
    options: {
      '--collection': '<name>',
      '--limit': '<number>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  stats: {
    options: {
      '--collection': '<name>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  domains: {
    options: {
      '--collection': '<name>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  delete: {
    options: {
      '-k': '<key>',
      '--api-key': '<key>',
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  history: {
    options: {
      '--command': ['scrape', 'crawl', 'map', 'search', 'extract', 'batch'],
      '--limit': '<number>',
      '--clear': [],
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },

  info: {
    options: {
      '-o': '<file>',
      '--output': '<file>',
      '--json': [],
      '--pretty': [],
    },
  },
};

/**
 * Type definition for completion tree structure
 */
export type CompletionTree = typeof completionTree;
export type CompletionValue = string[] | string | never[];
export type CompletionOptions = Record<string, CompletionValue>;
export interface CompletionCommand {
  options?: CompletionOptions;
  subcommands?: Record<string, CompletionCommand>;
}
