#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_VERSION="0.1.0"

REPO_URL="${AXON_REPO_URL:-https://github.com/jmagar/axon.git}"
INSTALL_DIR="${AXON_INSTALL_DIR:-$HOME/.local/share/axon}"
AXON_HOME_DEFAULT="${AXON_HOME:-$HOME/.axon}"
SKIP_DOCKER=0
SKIP_LINKS=0
SKIP_PORT_CHECK=0

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*"
}

warn() {
  printf '[%s] WARNING: %s\n' "$SCRIPT_NAME" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

usage() {
  cat <<USAGE
Axon installer v$SCRIPT_VERSION

Usage:
  $SCRIPT_NAME [options]

Options:
  --install-dir <path>   Install/update repo in this directory when run outside a repo
  --repo-url <url>       Git URL to clone/pull (default: $REPO_URL)
  --skip-docker          Skip docker compose deployment
  --skip-links           Skip Claude/Codex/Gemini/Opencode symlink setup
  --skip-port-check      Skip host port conflict detection/auto-adjustment
  -h, --help             Show this help

Examples:
  curl -fsSL https://raw.githubusercontent.com/jmagar/axon/main/scripts/install.sh | bash
  AXON_INSTALL_DIR=\"$HOME/src/axon\" $SCRIPT_NAME
USAGE
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      [[ $# -ge 2 ]] || die "--install-dir requires a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --repo-url)
      [[ $# -ge 2 ]] || die "--repo-url requires a value"
      REPO_URL="$2"
      shift 2
      ;;
    --skip-docker)
      SKIP_DOCKER=1
      shift
      ;;
    --skip-links)
      SKIP_LINKS=1
      shift
      ;;
    --skip-port-check)
      SKIP_PORT_CHECK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

require_cmd() {
  local cmd="$1"
  command_exists "$cmd" || die "Required command not found: $cmd"
}

require_cmd git
require_cmd docker

if [[ -f "docker-compose.yaml" && -f "package.json" ]]; then
  REPO_DIR="$PWD"
  log "Using existing Axon repo: $REPO_DIR"
else
  REPO_DIR="$INSTALL_DIR"
  mkdir -p "$(dirname "$REPO_DIR")"

  if [[ -d "$REPO_DIR/.git" ]]; then
    log "Updating existing repo at $REPO_DIR"
    git -C "$REPO_DIR" fetch --all --tags --prune
    git -C "$REPO_DIR" pull --ff-only
  else
    if [[ -e "$REPO_DIR" && ! -d "$REPO_DIR" ]]; then
      die "Install path exists and is not a directory: $REPO_DIR"
    fi
    log "Cloning repo into $REPO_DIR"
    rm -rf "$REPO_DIR"
    git clone --depth 1 "$REPO_URL" "$REPO_DIR"
  fi
fi

cd "$REPO_DIR"

[[ -f .env.example ]] || die "Missing .env.example in repo root"
if [[ ! -f .env ]]; then
  cp .env.example .env
  log "Created .env from .env.example"
fi

upsert_env() {
  local key="$1"
  local value="$2"
  local file=".env"

  awk -v k="$key" -v v="$value" '
    BEGIN { updated=0 }
    $0 ~ "^" k "=" {
      print k "=" v
      updated=1
      next
    }
    { print }
    END {
      if (!updated) {
        print k "=" v
      }
    }
  ' "$file" > "$file.tmp"

  mv "$file.tmp" "$file"
}

get_env_or_default() {
  local key="$1"
  local default_value="$2"
  local value
  value="$(grep -E "^${key}=" .env | tail -n1 | cut -d '=' -f2- || true)"
  if [[ -z "$value" ]]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$value"
  fi
}

random_hex() {
  local bytes="${1:-24}"
  if command_exists openssl; then
    openssl rand -hex "$bytes"
  else
    od -vAn -N"$bytes" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

is_port_in_use() {
  local port="$1"

  if command_exists ss; then
    ss -ltn "( sport = :${port} )" 2>/dev/null | awk 'NR>1 {print}' | grep -q .
    return
  fi

  if command_exists lsof; then
    lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1
    return
  fi

  return 1
}

find_free_port() {
  local start="$1"
  local end="$2"
  local p

  for ((p=start; p<=end; p++)); do
    if ! is_port_in_use "$p"; then
      printf '%s' "$p"
      return 0
    fi
  done

  return 1
}

set_default_ports() {
  upsert_env FIRECRAWL_PORT "$(get_env_or_default FIRECRAWL_PORT 53002)"
  upsert_env AXON_EMBEDDER_WEBHOOK_PORT "$(get_env_or_default AXON_EMBEDDER_WEBHOOK_PORT 53000)"
  upsert_env PLAYWRIGHT_PORT "$(get_env_or_default PLAYWRIGHT_PORT 53006)"
  upsert_env QDRANT_REST_PORT "$(get_env_or_default QDRANT_REST_PORT 53333)"
  upsert_env QDRANT_RPC_PORT "$(get_env_or_default QDRANT_RPC_PORT 53334)"
}

configure_secrets() {
  local api_key
  local webhook_secret

  api_key="$(get_env_or_default FIRECRAWL_API_KEY local-dev)"
  if [[ "$api_key" == "" || "$api_key" == "local-dev" || "$api_key" == "changeme" ]]; then
    api_key="fc_$(random_hex 20)"
    upsert_env FIRECRAWL_API_KEY "$api_key"
    log "Generated FIRECRAWL_API_KEY"
  fi

  webhook_secret="$(get_env_or_default AXON_EMBEDDER_WEBHOOK_SECRET "")"
  if [[ -z "$webhook_secret" || "$webhook_secret" == "whsec_change_me" ]]; then
    webhook_secret="whsec_$(random_hex 24)"
    upsert_env AXON_EMBEDDER_WEBHOOK_SECRET "$webhook_secret"
    log "Generated AXON_EMBEDDER_WEBHOOK_SECRET"
  fi

  upsert_env AXON_HOME "$AXON_HOME_DEFAULT"
}

adjust_ports_if_needed() {
  local running_count
  running_count="$(docker compose ps --services --status running 2>/dev/null | wc -l | tr -d ' ')"

  if [[ "$running_count" != "0" ]]; then
    log "Detected running Axon services; skipping automatic port reassignment"
    return
  fi

  local keys=(
    FIRECRAWL_PORT
    AXON_EMBEDDER_WEBHOOK_PORT
    PLAYWRIGHT_PORT
    QDRANT_REST_PORT
    QDRANT_RPC_PORT
  )

  local current_port
  local free_port
  for key in "${keys[@]}"; do
    current_port="$(get_env_or_default "$key" "")"

    if [[ ! "$current_port" =~ ^[0-9]+$ ]]; then
      warn "$key has non-numeric value '$current_port'; leaving as-is"
      continue
    fi

    if is_port_in_use "$current_port"; then
      free_port="$(find_free_port 53000 53999 || true)"
      [[ -n "$free_port" ]] || die "No free ports available in 53000-53999 for $key"
      warn "$key port $current_port is in use; reassigning to $free_port"
      upsert_env "$key" "$free_port"
    fi
  done
}

link_path() {
  local target="$1"
  local link="$2"
  local ts

  mkdir -p "$(dirname "$link")"
  if [[ -e "$link" && ! -L "$link" ]]; then
    ts="$(date +%Y%m%d%H%M%S)"
    mv "$link" "${link}.bak.${ts}"
  fi
  ln -sfn "$target" "$link"
}

install_cli_links() {
  local repo="$1"

  # Claude Code
  link_path "$repo/commands" "$HOME/.claude/commands/axon"
  link_path "$repo/skills/axon" "$HOME/.claude/skills/axon"

  # Codex
  link_path "$repo/skills/axon" "$HOME/.codex/skills/axon"

  # Gemini (best-effort convention)
  link_path "$repo/skills/axon" "$HOME/.gemini/skills/axon"

  # OpenCode (best-effort convention)
  link_path "$repo/skills/axon" "$HOME/.config/opencode/skills/axon"

  log "Installed CLI skill/command links for Claude, Codex, Gemini, and OpenCode"
}

set_default_ports
configure_secrets

if [[ "$SKIP_PORT_CHECK" -eq 0 ]]; then
  adjust_ports_if_needed
fi

if [[ "$SKIP_LINKS" -eq 0 ]]; then
  install_cli_links "$REPO_DIR"
fi

if [[ "$SKIP_DOCKER" -eq 0 ]]; then
  log "Deploying Axon Docker stack"
  docker compose pull --ignore-pull-failures
  docker compose up -d --build
  docker compose ps
fi

log "Install complete"
log "Repo: $REPO_DIR"
log "Environment: $REPO_DIR/.env"
log "Try: axon doctor --json --pretty"
