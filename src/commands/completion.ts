/**
 * Shell completion command implementation
 *
 * Provides shell completion setup and management for firecrawl CLI.
 * Supports bash, zsh, and fish shells with static completion of commands and options.
 */

import { Command } from 'commander';
import { detectShell, getShellRcPath } from '../utils/completion-helpers';
import { fmt, icons } from '../utils/theme';

/**
 * Generate bash completion script
 */
function generateBashScript(): string {
  return `# firecrawl CLI bash completion

_firecrawl_completions() {
    local cur prev words cword
    _init_completion || return

    # Top-level commands
    local commands="scrape crawl map search extract batch embed query retrieve list status config view-config login logout version sources stats domains delete history info completion help"

    # If we're on the first word, complete commands
    if [[ $cword -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
        return
    fi

    # Command-specific completions
    case "\${words[1]}" in
        scrape|crawl|map|search|extract|batch)
            # Common options for web operations
            COMPREPLY=( $(compgen -W "--help --api-key --output --pretty --json -o -k -h" -- "$cur") )
            ;;
        embed|query|retrieve)
            # Vector search options
            COMPREPLY=( $(compgen -W "--help --collection --output --pretty --json -o -h" -- "$cur") )
            ;;
        *)
            # Default to common flags
            COMPREPLY=( $(compgen -W "--help -h" -- "$cur") )
            ;;
    esac
}

complete -F _firecrawl_completions firecrawl
`;
}

/**
 * Generate zsh completion script
 */
function generateZshScript(): string {
  return `#compdef firecrawl

# firecrawl CLI zsh completion

_firecrawl() {
    local -a commands
    commands=(
        'scrape:Scrape a URL using Firecrawl'
        'crawl:Crawl a website using Firecrawl'
        'map:Map URLs on a website'
        'search:Search the web using Firecrawl'
        'extract:Extract structured data from URLs'
        'batch:Batch scrape multiple URLs'
        'embed:Embed content into Qdrant'
        'query:Semantic search over embedded content'
        'retrieve:Retrieve full document from Qdrant'
        'list:List active crawl jobs'
        'status:Show active jobs and embedding queue status'
        'config:Configure Firecrawl'
        'view-config:View current configuration'
        'login:Login to Firecrawl'
        'logout:Logout and clear credentials'
        'version:Display version information'
        'sources:List all indexed source URLs'
        'stats:Show vector database statistics'
        'domains:List unique indexed domains'
        'delete:Delete vectors from database'
        'history:Show time-based index history'
        'info:Show detailed information for a URL'
        'completion:Manage shell completion'
        'help:Display help for command'
    )

    _arguments -C \\
        '1: :->command' \\
        '*:: :->args'

    case $state in
        command)
            _describe 'command' commands
            ;;
        args)
            case \${words[1]} in
                scrape|crawl|map|search|extract|batch)
                    _arguments \\
                        '--help[Display help]' \\
                        '--api-key[Firecrawl API key]:key' \\
                        '(-o --output)'{-o,--output}'[Output file path]:file:_files' \\
                        '--pretty[Pretty print JSON]' \\
                        '--json[Output as JSON]'
                    ;;
                embed|query|retrieve)
                    _arguments \\
                        '--help[Display help]' \\
                        '--collection[Collection name]:name' \\
                        '(-o --output)'{-o,--output}'[Output file path]:file:_files' \\
                        '--pretty[Pretty print JSON]' \\
                        '--json[Output as JSON]'
                    ;;
                *)
                    _arguments '--help[Display help]'
                    ;;
            esac
            ;;
    esac
}

_firecrawl
`;
}

/**
 * Generate fish completion script
 */
function generateFishScript(): string {
  return `# firecrawl CLI fish completion

# Top-level commands
complete -c firecrawl -f -n "__fish_use_subcommand" -a scrape -d "Scrape a URL using Firecrawl"
complete -c firecrawl -f -n "__fish_use_subcommand" -a crawl -d "Crawl a website using Firecrawl"
complete -c firecrawl -f -n "__fish_use_subcommand" -a map -d "Map URLs on a website"
complete -c firecrawl -f -n "__fish_use_subcommand" -a search -d "Search the web using Firecrawl"
complete -c firecrawl -f -n "__fish_use_subcommand" -a extract -d "Extract structured data from URLs"
complete -c firecrawl -f -n "__fish_use_subcommand" -a batch -d "Batch scrape multiple URLs"
complete -c firecrawl -f -n "__fish_use_subcommand" -a embed -d "Embed content into Qdrant"
complete -c firecrawl -f -n "__fish_use_subcommand" -a query -d "Semantic search over embedded content"
complete -c firecrawl -f -n "__fish_use_subcommand" -a retrieve -d "Retrieve document from Qdrant"
complete -c firecrawl -f -n "__fish_use_subcommand" -a list -d "List active crawl jobs"
complete -c firecrawl -f -n "__fish_use_subcommand" -a status -d "Show active jobs status"
complete -c firecrawl -f -n "__fish_use_subcommand" -a config -d "Configure Firecrawl"
complete -c firecrawl -f -n "__fish_use_subcommand" -a view-config -d "View current configuration"
complete -c firecrawl -f -n "__fish_use_subcommand" -a login -d "Login to Firecrawl"
complete -c firecrawl -f -n "__fish_use_subcommand" -a logout -d "Logout and clear credentials"
complete -c firecrawl -f -n "__fish_use_subcommand" -a version -d "Display version information"
complete -c firecrawl -f -n "__fish_use_subcommand" -a sources -d "List indexed source URLs"
complete -c firecrawl -f -n "__fish_use_subcommand" -a stats -d "Show vector database statistics"
complete -c firecrawl -f -n "__fish_use_subcommand" -a domains -d "List indexed domains"
complete -c firecrawl -f -n "__fish_use_subcommand" -a delete -d "Delete vectors from database"
complete -c firecrawl -f -n "__fish_use_subcommand" -a history -d "Show time-based index history"
complete -c firecrawl -f -n "__fish_use_subcommand" -a info -d "Show detailed URL information"
complete -c firecrawl -f -n "__fish_use_subcommand" -a completion -d "Manage shell completion"
complete -c firecrawl -f -n "__fish_use_subcommand" -a help -d "Display help"

# Common options for all commands
complete -c firecrawl -l help -d "Display help"
complete -c firecrawl -s h -d "Display help"
complete -c firecrawl -l api-key -d "Firecrawl API key" -x
complete -c firecrawl -s k -d "Firecrawl API key" -x
complete -c firecrawl -l output -d "Output file path" -r
complete -c firecrawl -s o -d "Output file path" -r
complete -c firecrawl -l pretty -d "Pretty print JSON"
complete -c firecrawl -l json -d "Output as JSON"
`;
}

/**
 * Install completion for the given shell
 *
 * @param shell - Shell type ('bash', 'zsh', or 'fish')
 */
function installCompletion(shell: string): void {
  const rcPath = getShellRcPath(shell);

  if (!rcPath) {
    console.error(fmt.error(`Unsupported shell: ${shell}`));
    process.exit(1);
  }

  // Generate script based on shell
  let script: string;
  switch (shell) {
    case 'bash':
      script = generateBashScript();
      break;
    case 'zsh':
      script = generateZshScript();
      break;
    case 'fish':
      script = generateFishScript();
      break;
    default:
      console.error(fmt.error(`Unsupported shell: ${shell}`));
      process.exit(1);
  }

  console.log(
    fmt.success(`${icons.success} Completion script generated for ${shell}`)
  );
  console.log(fmt.dim(`\nTo enable completion, add this to your ${rcPath}:\n`));
  console.log(fmt.primary(`# firecrawl CLI completion`));
  console.log(script);
  console.log(fmt.dim(`\nOr run this command to append it automatically:`));
  console.log(fmt.primary(`firecrawl completion script ${shell} >> ${rcPath}`));
  console.log(fmt.dim(`\nThen restart your shell or run: source ${rcPath}`));
}

/**
 * Output completion script for the given shell
 *
 * @param shell - Shell type ('bash', 'zsh', or 'fish')
 */
function outputScript(shell: string): void {
  let script: string;
  switch (shell) {
    case 'bash':
      script = generateBashScript();
      break;
    case 'zsh':
      script = generateZshScript();
      break;
    case 'fish':
      script = generateFishScript();
      break;
    default:
      console.error(fmt.error(`Unsupported shell: ${shell}`));
      process.exit(1);
  }

  console.log(script);
}

/**
 * Uninstall completion (provide instructions)
 *
 * @param shell - Shell type ('bash', 'zsh', or 'fish')
 */
function uninstallCompletion(shell: string): void {
  const rcPath = getShellRcPath(shell);

  if (!rcPath) {
    console.error(fmt.error(`Unsupported shell: ${shell}`));
    process.exit(1);
  }

  console.log(fmt.success(`${icons.success} To uninstall completion:`));
  console.log(fmt.dim(`\n1. Open ${rcPath} in your editor`));
  console.log(fmt.dim(`2. Remove the firecrawl completion section`));
  console.log(fmt.dim(`3. Save and restart your shell\n`));
}

/**
 * Create and configure the completion command
 *
 * @returns Configured Commander.js command
 */
export function createCompletionCommand(): Command {
  const completionCmd = new Command('completion').description(
    'Manage shell completion for firecrawl CLI'
  );

  // Install subcommand
  completionCmd
    .command('install')
    .description('Show completion installation instructions')
    .argument('[shell]', 'Shell type: bash, zsh, or fish')
    .action((shell?: string) => {
      const targetShell = shell || detectShell();

      if (targetShell === 'unknown') {
        console.error(
          fmt.error(
            'Could not detect shell. Please specify: bash, zsh, or fish'
          )
        );
        process.exit(1);
      }

      installCompletion(targetShell);
    });

  // Uninstall subcommand
  completionCmd
    .command('uninstall')
    .description('Show completion uninstallation instructions')
    .argument('[shell]', 'Shell type: bash, zsh, or fish')
    .action((shell?: string) => {
      const targetShell = shell || detectShell();

      if (targetShell === 'unknown') {
        console.error(
          fmt.error(
            'Could not detect shell. Please specify: bash, zsh, or fish'
          )
        );
        process.exit(1);
      }

      uninstallCompletion(targetShell);
    });

  // Script subcommand
  completionCmd
    .command('script')
    .description('Output completion script for manual installation')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell: string) => {
      if (!['bash', 'zsh', 'fish'].includes(shell)) {
        console.error(fmt.error('Invalid shell. Choose: bash, zsh, or fish'));
        process.exit(1);
      }

      outputScript(shell);
    });

  return completionCmd;
}
