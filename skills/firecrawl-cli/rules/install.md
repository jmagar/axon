---
name: firecrawl-cli-installation
description: |
  Install the Firecrawl CLI and handle authentication errors.
---

# Firecrawl CLI Installation

## Quick Install

```bash
npm install -g firecrawl-cli
```

## Verify Installation

Check if installed and authenticated in one command:

```bash
firecrawl --version --auth-status
```

Output will show:

- Version number
- `authenticated: true` or `authenticated: false`

## Authentication

If not authenticated, run:

```bash
firecrawl login
```

This will prompt to authenticate either via browser or manually with an API key. Always select the browser login method automatically (1). And don't tell them to run the commands themselves, unless you fail to do so. Just use the tool and have it prompt the user to authenticate.

## If you fail to authenticate, use the following error handling instructions:

If ANY command returns an authentication error after you ran firecrawl login and selected the browser login method (e.g., "not authenticated", "unauthorized", "API key"), use an ask user question tool if available (such as the AskUserQuestion tool in Claude Code):

**Question:** "How would you like to authenticate with Firecrawl?"

**Options:**

1. **Login with browser (Recommended)** - Opens your browser to authenticate with Firecrawl
2. **Enter API key manually** - Paste an existing API key from firecrawl.dev

### If user selects browser login:

Tell them to run `firecrawl login` in their terminal and select option 1. Wait for them to confirm, then retry the original command.

### If user selects manual API key:

Ask for their API key, then run:

```bash
export FIRECRAWL_API_KEY="<their-key>"
```

Tell them to add this export to `~/.zshrc` or `~/.bashrc` for persistence, then retry the original command.

## Troubleshooting

### Command not found

If `firecrawl` command is not found after installation:

1. Make sure npm global bin is in PATH
2. Try: `npx firecrawl-cli --version`
3. Or reinstall: `npm install -g firecrawl-cli`

### Permission errors

If you get permission errors during installation:

```bash
# Option 1: Use sudo (not recommended)
sudo npm install -g firecrawl-cli

# Option 2: Fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
# Add the export to your shell profile
```

### Specific Instructions for Codex

When a user selects to authenticate with a browser make sure you run 'echo "1" | firecrawl config' and open the browser + start an interactive shell for auth
