/**
 * Shell completion command implementation
 *
 * Provides shell completion setup and management for axon CLI.
 * Supports bash, zsh, and fish shells with static completion of commands and options.
 */

import { Command } from 'commander';
import { detectShell, getShellRcPath } from '../utils/completion-helpers';
import { formatHeaderBlock } from '../utils/display';
import { fmt, icons } from '../utils/theme';

/**
 * Generate bash completion script
 */
function generateBashScript(): string {
  return `# axon CLI bash completion

_axon_completions() {
    local cur prev words cword
    _init_completion || return

    # Top-level commands
    local commands="scrape crawl map search extract batch embed query reconcile retrieve list status config view-config login logout version doctor sources stats domains delete history info completion help"

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

complete -F _axon_completions axon
`;
}

/**
 * Generate zsh completion script
 */
function generateZshScript(): string {
  return `#compdef axon

# axon CLI zsh completion

_axon() {
    local -a commands
    commands=(
        'scrape:Scrape a URL using Axon'
        'crawl:Crawl a website using Axon'
        'map:Map URLs on a website'
        'search:Search the web using Axon'
        'extract:Extract structured data from URLs'
        'batch:Batch scrape multiple URLs'
        'embed:Embed content into Qdrant'
        'query:Semantic search over embedded content'
        'reconcile:Inspect and control crawl reconciliation state'
        'retrieve:Retrieve full document from Qdrant'
        'list:List active crawl jobs'
        'status:Show active jobs and embedding queue status'
        'config:Configure Axon'
        'view-config:View current configuration'
        'login:Login to Axon'
        'logout:Logout and clear credentials'
        'version:Display version information'
        'doctor:Run local diagnostics for services and config'
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
                        '--api-key[API key]:key' \\
                        '(-o --output)'{-o,--output}'[Output file path]:file:_files' \\
                        '--pretty[Pretty print JSON]' \\
                        '--json[Output as JSON]'
                    ;;
                doctor)
                    _arguments \\
                        '--help[Display help]' \\
                        '--json[Output JSON (compact)]' \\
                        '--pretty[Pretty print JSON output]' \\
                        '--timeout[Probe timeout in milliseconds]:ms' \\
                        '--ai-timeout[AI debug timeout in milliseconds]:ms'
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

_axon
`;
}

/**
 * Generate fish completion script
 */
function generateFishScript(): string {
  return `# axon CLI fish completion

# Top-level commands
complete -c axon -f -n "__fish_use_subcommand" -a scrape -d "Scrape a URL using Axon"
complete -c axon -f -n "__fish_use_subcommand" -a crawl -d "Crawl a website using Axon"
complete -c axon -f -n "__fish_use_subcommand" -a map -d "Map URLs on a website"
complete -c axon -f -n "__fish_use_subcommand" -a search -d "Search the web using Axon"
complete -c axon -f -n "__fish_use_subcommand" -a extract -d "Extract structured data from URLs"
complete -c axon -f -n "__fish_use_subcommand" -a batch -d "Batch scrape multiple URLs"
complete -c axon -f -n "__fish_use_subcommand" -a embed -d "Embed content into Qdrant"
complete -c axon -f -n "__fish_use_subcommand" -a query -d "Semantic search over embedded content"
complete -c axon -f -n "__fish_use_subcommand" -a reconcile -d "Inspect and control crawl reconciliation state"
complete -c axon -f -n "__fish_use_subcommand" -a retrieve -d "Retrieve document from Qdrant"
complete -c axon -f -n "__fish_use_subcommand" -a list -d "List active crawl jobs"
complete -c axon -f -n "__fish_use_subcommand" -a status -d "Show active jobs status"
complete -c axon -f -n "__fish_use_subcommand" -a config -d "Configure Axon"
complete -c axon -f -n "__fish_use_subcommand" -a view-config -d "View current configuration"
complete -c axon -f -n "__fish_use_subcommand" -a login -d "Login to Axon"
complete -c axon -f -n "__fish_use_subcommand" -a logout -d "Logout and clear credentials"
complete -c axon -f -n "__fish_use_subcommand" -a version -d "Display version information"
complete -c axon -f -n "__fish_use_subcommand" -a doctor -d "Run local diagnostics"
complete -c axon -f -n "__fish_use_subcommand" -a sources -d "List indexed source URLs"
complete -c axon -f -n "__fish_use_subcommand" -a stats -d "Show vector database statistics"
complete -c axon -f -n "__fish_use_subcommand" -a domains -d "List indexed domains"
complete -c axon -f -n "__fish_use_subcommand" -a delete -d "Delete vectors from database"
complete -c axon -f -n "__fish_use_subcommand" -a history -d "Show time-based index history"
complete -c axon -f -n "__fish_use_subcommand" -a info -d "Show detailed URL information"
complete -c axon -f -n "__fish_use_subcommand" -a completion -d "Manage shell completion"
complete -c axon -f -n "__fish_use_subcommand" -a help -d "Display help"

# Common options for all commands
complete -c axon -l help -d "Display help"
complete -c axon -s h -d "Display help"
complete -c axon -l api-key -d "API key" -x
complete -c axon -s k -d "API key" -x
complete -c axon -l output -d "Output file path" -r
complete -c axon -s o -d "Output file path" -r
complete -c axon -l pretty -d "Pretty print JSON"
complete -c axon -l json -d "Output as JSON"
`;
}

/**
 * Generate completion script for the given shell
 * @param shell - Shell type ('bash', 'zsh', or 'fish')
 * @returns Completion script or null if unsupported
 */
function generateScript(shell: string): string | null {
  switch (shell) {
    case 'bash':
      return generateBashScript();
    case 'zsh':
      return generateZshScript();
    case 'fish':
      return generateFishScript();
    default:
      return null;
  }
}

/**
 * Validate shell and get RC path
 * @param shell - Shell type to validate
 * @returns RC file path
 * @throws Error if shell is unsupported
 */
function validateShellAndGetRcPath(shell: string): string {
  const rcPath = getShellRcPath(shell);
  if (!rcPath) {
    throw new Error(`Unsupported shell: ${shell}`);
  }
  return rcPath;
}

/**
 * Resolve target shell, handling auto-detection and validation
 * @param providedShell - Optional shell override
 * @returns Validated shell type
 * @throws Error if shell cannot be detected
 */
function resolveTargetShell(providedShell?: string): string {
  const targetShell = providedShell || detectShell();
  if (targetShell === 'unknown') {
    throw new Error(
      'Could not detect shell. Please specify: bash, zsh, or fish'
    );
  }
  return targetShell;
}

/**
 * Install completion for the given shell
 *
 * @param shell - Shell type ('bash', 'zsh', or 'fish')
 */
function installCompletion(shell: string): void {
  const rcPath = validateShellAndGetRcPath(shell);
  const script = generateScript(shell);

  if (!script) {
    throw new Error(`Unsupported shell: ${shell}`);
  }

  for (const line of formatHeaderBlock({
    title: `Completion Install for ${shell}`,
    summary: ['state: script generated', `rc: ${rcPath}`],
  })) {
    console.log(line);
  }
  console.log(
    fmt.success(`${icons.success} Completion script generated for ${shell}`)
  );
  console.log('');
  console.log(fmt.primary('Install:'));
  console.log(fmt.dim(`To enable completion, add this to your ${rcPath}:`));
  console.log('');
  console.log(fmt.primary(`# axon CLI completion`));
  console.log(script);
  console.log('');
  console.log(fmt.dim('Or run this command to append it automatically:'));
  console.log(fmt.primary(`axon completion script ${shell} >> ${rcPath}`));
  console.log('');
  console.log(fmt.primary('Next:'));
  console.log(fmt.dim(`Then restart your shell or run: source ${rcPath}`));
}

/**
 * Output completion script for the given shell
 *
 * @param shell - Shell type ('bash', 'zsh', or 'fish')
 */
function outputScript(shell: string): void {
  const script = generateScript(shell);
  if (!script) {
    throw new Error(`Unsupported shell: ${shell}`);
  }
  console.log(script);
}

/**
 * Uninstall completion (provide instructions)
 *
 * @param shell - Shell type ('bash', 'zsh', or 'fish')
 */
function uninstallCompletion(shell: string): void {
  const rcPath = validateShellAndGetRcPath(shell);

  for (const line of formatHeaderBlock({
    title: `Completion Uninstall for ${shell}`,
    summary: ['state: manual removal required', `rc: ${rcPath}`],
  })) {
    console.log(line);
  }
  console.log(fmt.success(`${icons.success} To uninstall completion:`));
  console.log('');
  console.log(fmt.dim(`1. Open ${rcPath} in your editor`));
  console.log(fmt.dim(`2. Remove the axon completion section`));
  console.log(fmt.dim('3. Save and restart your shell'));
  console.log('');
}

/**
 * Create and configure the completion command
 *
 * @returns Configured Commander.js command
 */
export function createCompletionCommand(): Command {
  const completionCmd = new Command('completion').description(
    'Manage shell completion for axon CLI'
  );

  // Install subcommand
  completionCmd
    .command('install')
    .description('Show completion installation instructions')
    .argument('[shell]', 'Shell type: bash, zsh, or fish')
    .action((shell?: string) => {
      installCompletion(resolveTargetShell(shell));
    });

  // Uninstall subcommand
  completionCmd
    .command('uninstall')
    .description('Show completion uninstallation instructions')
    .argument('[shell]', 'Shell type: bash, zsh, or fish')
    .action((shell?: string) => {
      uninstallCompletion(resolveTargetShell(shell));
    });

  // Script subcommand
  completionCmd
    .command('script')
    .description('Output completion script for manual installation')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell: string) => {
      if (!['bash', 'zsh', 'fish'].includes(shell)) {
        throw new Error('Invalid shell. Choose: bash, zsh, or fish');
      }

      outputScript(shell);
    });

  return completionCmd;
}
