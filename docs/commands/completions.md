# axon completions
Last Modified: 2026-03-10

Generate shell completion scripts for `axon`.

## Synopsis

```bash
axon completions <bash|zsh|fish>
axon completion <bash|zsh|fish>
```

## Examples

```bash
# Bash
axon completions bash > ~/.local/share/bash-completion/completions/axon

# Zsh
mkdir -p ~/.zfunc
axon completions zsh > ~/.zfunc/_axon

# Fish
mkdir -p ~/.config/fish/completions
axon completions fish > ~/.config/fish/completions/axon.fish
```

## Installation

- Bash: write the script to `~/.local/share/bash-completion/completions/axon`, then restart the shell or `source` the file.
- Zsh: write the script to a directory in `fpath` such as `~/.zfunc/_axon`, add `fpath=(~/.zfunc $fpath)` to `.zshrc` if needed, then run `autoload -Uz compinit && compinit`.
- Fish: write the script to `~/.config/fish/completions/axon.fish`; fish loads it automatically in new shells.

## Notes

- Completion generation is local-only and does not require Axon service env vars.
- The generated scripts cover top-level commands, the `completion`/`completions` shell selector, and global long flags.
