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
SKIP_HEALTH_CHECK=0
DRY_RUN=0
NON_INTERACTIVE=0
DEPLOYMENT_MODE="${AXON_DEPLOYMENT_MODE:-}"
CLI_TARGETS_ARG="${AXON_CLI_TARGETS:-}"

MAIN_SERVICES=()
DEPLOY_LOCAL_TEI=0
TEI_PROFILE=""
TEI_ENV_FILE=""
TEI_COMPOSE_FILE=""

EXPECT_LOCAL_FIRECRAWL=0
EXPECT_LOCAL_EMBEDDER=0
EXPECT_LOCAL_QDRANT=0
EXPECT_LOCAL_TEI=0

DETECTED_LINK_TARGETS=()
SELECTED_LINK_TARGETS=()
COPILOT_INSTALLED=0

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
  --skip-links           Skip CLI skill/command symlink setup
  --skip-port-check      Skip host port conflict detection/auto-adjustment
  --skip-health-check    Skip post-deploy service health verification
  --deployment-mode <m>  Deployment mode:
                         full-local | full-remote-tei | external-firecrawl | external-vector
  --cli-targets <csv>    CLI targets for skill install (claude,codex,gemini,opencode)
  --non-interactive      Do not prompt; use flags/env/defaults
  --dry-run              Print planned actions without making changes
  -h, --help             Show this help

Examples:
  curl -fsSL https://raw.githubusercontent.com/jmagar/axon/main/scripts/install.sh | bash
  AXON_INSTALL_DIR=\"$HOME/src/axon\" $SCRIPT_NAME
  $SCRIPT_NAME --deployment-mode external-firecrawl
  $SCRIPT_NAME --cli-targets claude,codex
  $SCRIPT_NAME --dry-run
USAGE
}

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] $*"
    return 0
  fi

  "$@"
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
    --skip-health-check)
      SKIP_HEALTH_CHECK=1
      shift
      ;;
    --deployment-mode)
      [[ $# -ge 2 ]] || die "--deployment-mode requires a value"
      DEPLOYMENT_MODE="$2"
      shift 2
      ;;
    --cli-targets)
      [[ $# -ge 2 ]] || die "--cli-targets requires a value"
      CLI_TARGETS_ARG="$2"
      shift 2
      ;;
    --non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
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

check_docker_ready() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would verify Docker daemon availability"
    return 0
  fi

  docker info >/dev/null 2>&1 || die "Docker daemon is not running or not reachable"
  docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is not available"
}

if [[ -f "docker-compose.yaml" && -f "package.json" ]]; then
  REPO_DIR="$PWD"
  log "Using existing Axon repo: $REPO_DIR"
else
  REPO_DIR="$INSTALL_DIR"
  run_cmd mkdir -p "$(dirname "$REPO_DIR")"

  if [[ -d "$REPO_DIR/.git" ]]; then
    log "Updating existing repo at $REPO_DIR"
    run_cmd git -C "$REPO_DIR" fetch --all --tags --prune
    run_cmd git -C "$REPO_DIR" pull --ff-only
  else
    if [[ -e "$REPO_DIR" && ! -d "$REPO_DIR" ]]; then
      die "Install path exists and is not a directory: $REPO_DIR"
    fi
    log "Cloning repo into $REPO_DIR"
    run_cmd rm -rf "$REPO_DIR"
    run_cmd git clone --depth 1 "$REPO_URL" "$REPO_DIR"
  fi
fi

cd "$REPO_DIR"

[[ -f .env.example ]] || die "Missing .env.example in repo root"
if [[ ! -f .env ]]; then
  run_cmd cp .env.example .env
  log "Created .env from .env.example"
fi

ENV_FILE=".env"
if [[ ! -f "$ENV_FILE" && "$DRY_RUN" -eq 1 ]]; then
  ENV_FILE=".env.example"
  log "[dry-run] .env does not exist yet; reading defaults from .env.example"
fi

upsert_env() {
  local key="$1"
  local value="$2"
  local file="$ENV_FILE"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    local current
    current="$(grep -E "^${key}=" "$file" | tail -n1 | cut -d '=' -f2- || true)"
    if [[ -z "$current" ]]; then
      log "[dry-run] would add ${key}=${value}"
    elif [[ "$current" != "$value" ]]; then
      log "[dry-run] would update ${key} from '${current}' to '${value}'"
    fi
    return 0
  fi

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
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d '=' -f2- || true)"
  value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^\x27(.*)\x27$/\1/')"
  if [[ -z "$value" ]]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$value"
  fi
}

is_prompt_mode() {
  [[ "$NON_INTERACTIVE" -eq 0 && -t 0 && -t 1 ]]
}

prompt_input() {
  local prompt_text="$1"
  local default_value="${2:-}"
  local response

  if ! is_prompt_mode; then
    printf '%s' "$default_value"
    return 0
  fi

  if [[ -n "$default_value" ]]; then
    printf '%s [%s]: ' "$prompt_text" "$default_value" >&2
  else
    printf '%s: ' "$prompt_text" >&2
  fi

  read -r response || true
  if [[ -z "$response" ]]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$response"
  fi
}

append_detected_target() {
  local target="$1"
  DETECTED_LINK_TARGETS+=("$target")
}

detect_cli_targets() {
  DETECTED_LINK_TARGETS=()
  COPILOT_INSTALLED=0

  if command_exists claude; then
    append_detected_target "claude"
  fi
  if command_exists codex; then
    append_detected_target "codex"
  fi
  if command_exists gemini; then
    append_detected_target "gemini"
  fi
  if command_exists opencode; then
    append_detected_target "opencode"
  fi

  if command_exists gh && gh copilot --help >/dev/null 2>&1; then
    COPILOT_INSTALLED=1
  fi
}

is_target_detected() {
  local target="$1"
  local item
  for item in "${DETECTED_LINK_TARGETS[@]}"; do
    if [[ "$item" == "$target" ]]; then
      return 0
    fi
  done
  return 1
}

parse_cli_targets_csv() {
  local csv="$1"
  local token
  local normalized
  SELECTED_LINK_TARGETS=()

  IFS=',' read -r -a _tokens <<< "$csv"
  for token in "${_tokens[@]}"; do
    normalized="$(printf '%s' "$token" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -n "$normalized" ]] || continue
    case "$normalized" in
      claude|codex|gemini|opencode)
        if is_target_detected "$normalized"; then
          SELECTED_LINK_TARGETS+=("$normalized")
        else
          warn "Requested CLI target '$normalized' is not installed; skipping"
        fi
        ;;
      *)
        warn "Unknown CLI target '$normalized'; expected claude,codex,gemini,opencode"
        ;;
    esac
  done
}

choose_cli_targets() {
  detect_cli_targets

  if [[ ${#DETECTED_LINK_TARGETS[@]} -eq 0 ]]; then
    warn "No supported CLI targets detected for automatic skill install"
    SKIP_LINKS=1
    return 0
  fi

  if [[ "$COPILOT_INSTALLED" -eq 1 ]]; then
    warn "GitHub Copilot CLI detected, but automatic skill installation is not supported for it"
  fi

  if [[ -n "$CLI_TARGETS_ARG" ]]; then
    parse_cli_targets_csv "$CLI_TARGETS_ARG"
    if [[ ${#SELECTED_LINK_TARGETS[@]} -eq 0 ]]; then
      warn "No valid installed CLI targets selected via --cli-targets; skipping link setup"
      SKIP_LINKS=1
    fi
    return 0
  fi

  if ! is_prompt_mode; then
    SELECTED_LINK_TARGETS=("${DETECTED_LINK_TARGETS[@]}")
    return 0
  fi

  echo "Detected CLI targets:"
  local i=1
  local target
  for target in "${DETECTED_LINK_TARGETS[@]}"; do
    echo "  ${i}) ${target}"
    i=$((i + 1))
  done

  local default_targets
  default_targets="$(IFS=,; echo "${DETECTED_LINK_TARGETS[*]}")"
  local chosen
  chosen="$(prompt_input "CLI targets to install skill/commands for (comma list)" "$default_targets")"
  parse_cli_targets_csv "$chosen"

  if [[ ${#SELECTED_LINK_TARGETS[@]} -eq 0 ]]; then
    warn "No valid CLI targets selected; skipping link setup"
    SKIP_LINKS=1
  fi
}

select_deployment_mode() {
  if [[ -n "$DEPLOYMENT_MODE" ]]; then
    return 0
  fi

  if ! is_prompt_mode; then
    DEPLOYMENT_MODE="full-local"
    warn "No deployment mode provided in non-interactive mode; defaulting to '${DEPLOYMENT_MODE}'"
    return 0
  fi

  cat <<'EOF'
Select deployment mode:
  1) full-local        -> Firecrawl stack + Embedder + Qdrant + local TEI + Axon CLI
  2) full-remote-tei   -> Firecrawl stack + Embedder + Qdrant + Axon CLI (TEI remote GPU)
  3) external-firecrawl-> Embedder + Qdrant + local TEI + Axon CLI (Firecrawl external/cloud)
  4) external-vector   -> Embedder + Axon CLI (Firecrawl + embeddings/vector external)
EOF

  local choice
  choice="$(prompt_input "Enter choice (1-4)" "1")"
  case "$choice" in
    1) DEPLOYMENT_MODE="full-local" ;;
    2) DEPLOYMENT_MODE="full-remote-tei" ;;
    3) DEPLOYMENT_MODE="external-firecrawl" ;;
    4) DEPLOYMENT_MODE="external-vector" ;;
    *) die "Invalid deployment mode choice: $choice" ;;
  esac
}

select_tei_profile() {
  if [[ -n "$TEI_PROFILE" ]]; then
    return 0
  fi

  if ! is_prompt_mode; then
    TEI_PROFILE="rtx4070"
    warn "No TEI profile provided in non-interactive mode; defaulting to '${TEI_PROFILE}'"
    return 0
  fi

  cat <<'EOF'
Select local TEI profile:
  1) rtx4070 -> Qwen profile optimized for NVIDIA RTX 4070 class GPUs
  2) rtx3050 -> Mixedbread profile tuned for RTX 3050 / 8GB VRAM
EOF

  local choice
  choice="$(prompt_input "Enter choice (1-2)" "1")"
  case "$choice" in
    1) TEI_PROFILE="rtx4070" ;;
    2) TEI_PROFILE="rtx3050" ;;
    *) die "Invalid TEI profile choice: $choice" ;;
  esac
}

is_numeric_port() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1024 && value <= 65535 ))
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

validate_env_configuration() {
  local key
  local value
  local default_value
  local keys=(
    "FIRECRAWL_PORT:53002"
    "AXON_EMBEDDER_WEBHOOK_PORT:53000"
    "PLAYWRIGHT_PORT:53006"
    "QDRANT_REST_PORT:53333"
    "QDRANT_RPC_PORT:53334"
  )

  for key in "${keys[@]}"; do
    default_value="${key#*:}"
    key="${key%%:*}"
    value="$(get_env_or_default "$key" "$default_value")"
    if ! is_numeric_port "$value"; then
      die "$key must be a numeric port between 1024-65535 (got '$value')"
    fi
  done

  local firecrawl_api_url
  firecrawl_api_url="$(get_env_or_default FIRECRAWL_API_URL "http://localhost:53002")"
  if [[ ! "$firecrawl_api_url" =~ ^https?:// ]]; then
    warn "FIRECRAWL_API_URL does not look like an HTTP URL: $firecrawl_api_url"
  fi
}

validate_compose_configuration() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would run: docker compose config -q"
    if [[ "$DEPLOY_LOCAL_TEI" -eq 1 ]]; then
      log "[dry-run] would run: docker compose --env-file ${TEI_ENV_FILE} -f ${TEI_COMPOSE_FILE} config -q"
    fi
    return 0
  fi

  docker compose config -q || die "docker-compose.yaml/.env validation failed"
  if [[ "$DEPLOY_LOCAL_TEI" -eq 1 ]]; then
    docker compose --env-file "$TEI_ENV_FILE" -f "$TEI_COMPOSE_FILE" config -q || die "TEI compose validation failed"
  fi
}

configure_secrets() {
  local api_key
  local webhook_secret

  api_key="$(get_env_or_default FIRECRAWL_API_KEY local-dev)"
  if [[ "$api_key" == "" || "$api_key" == "local-dev" || "$api_key" == "changeme" ]]; then
    api_key="fc_$(random_hex 20)"
    upsert_env FIRECRAWL_API_KEY "$api_key"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "[dry-run] would generate FIRECRAWL_API_KEY"
    else
      log "Generated FIRECRAWL_API_KEY"
    fi
  fi

  webhook_secret="$(get_env_or_default AXON_EMBEDDER_WEBHOOK_SECRET "")"
  if [[ -z "$webhook_secret" || "$webhook_secret" == "whsec_change_me" ]]; then
    webhook_secret="whsec_$(random_hex 24)"
    upsert_env AXON_EMBEDDER_WEBHOOK_SECRET "$webhook_secret"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "[dry-run] would generate AXON_EMBEDDER_WEBHOOK_SECRET"
    else
      log "Generated AXON_EMBEDDER_WEBHOOK_SECRET"
    fi
  fi

  upsert_env AXON_HOME "$AXON_HOME_DEFAULT"
}

get_kv_from_file_or_default() {
  local file_path="$1"
  local key="$2"
  local default_value="$3"
  local value

  if [[ -f "$file_path" ]]; then
    value="$(grep -E "^${key}=" "$file_path" | tail -n1 | cut -d '=' -f2- || true)"
    value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^\x27(.*)\x27$/\1/')"
  else
    value=""
  fi

  if [[ -z "$value" ]]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$value"
  fi
}

to_container_reachable_url() {
  local url="$1"
  url="${url/localhost/host.docker.internal}"
  url="${url/127.0.0.1/host.docker.internal}"
  printf '%s' "$url"
}

prepare_local_tei_env() {
  local template_file
  local tei_port_default

  case "$TEI_PROFILE" in
    rtx4070)
      TEI_ENV_FILE=".env.tei"
      TEI_COMPOSE_FILE="docker/docker-compose.tei.yaml"
      template_file="docker/.env.tei.rtx4070.example"
      tei_port_default="53020"
      ;;
    rtx3050)
      TEI_ENV_FILE=".env.tei.mxbai"
      TEI_COMPOSE_FILE="docker/docker-compose.tei.mxbai.yaml"
      template_file="docker/.env.tei.rtx3050.example"
      tei_port_default="53021"
      ;;
    *)
      die "Unsupported TEI profile: $TEI_PROFILE"
      ;;
  esac

  if [[ ! -f "$TEI_ENV_FILE" ]]; then
    run_cmd cp "$template_file" "$TEI_ENV_FILE"
    log "Created $TEI_ENV_FILE from $template_file"
  fi

  local tei_port
  if [[ "$DRY_RUN" -eq 1 && ! -f "$TEI_ENV_FILE" ]]; then
    tei_port="$(get_kv_from_file_or_default "$template_file" TEI_HTTP_PORT "$tei_port_default")"
  else
    tei_port="$(get_kv_from_file_or_default "$TEI_ENV_FILE" TEI_HTTP_PORT "$tei_port_default")"
  fi

  upsert_env TEI_URL "http://localhost:${tei_port}"
}

configure_deployment_mode() {
  select_deployment_mode

  case "$DEPLOYMENT_MODE" in
    full-local)
      DEPLOY_LOCAL_TEI=1
      EXPECT_LOCAL_FIRECRAWL=1
      EXPECT_LOCAL_EMBEDDER=1
      EXPECT_LOCAL_QDRANT=1
      EXPECT_LOCAL_TEI=1
      MAIN_SERVICES=()

      select_tei_profile
      prepare_local_tei_env

      upsert_env FIRECRAWL_API_URL "http://localhost:$(get_env_or_default FIRECRAWL_PORT 53002)"
      upsert_env AXON_EMBEDDER_FIRECRAWL_API_URL "http://axon-api:$(get_env_or_default FIRECRAWL_PORT 53002)"
      upsert_env QDRANT_URL "http://localhost:$(get_env_or_default QDRANT_REST_PORT 53333)"
      upsert_env AXON_EMBEDDER_QDRANT_URL "http://axon-qdrant:6333"
      ;;

    full-remote-tei)
      DEPLOY_LOCAL_TEI=0
      EXPECT_LOCAL_FIRECRAWL=1
      EXPECT_LOCAL_EMBEDDER=1
      EXPECT_LOCAL_QDRANT=1
      EXPECT_LOCAL_TEI=0
      MAIN_SERVICES=()

      upsert_env FIRECRAWL_API_URL "http://localhost:$(get_env_or_default FIRECRAWL_PORT 53002)"
      upsert_env AXON_EMBEDDER_FIRECRAWL_API_URL "http://axon-api:$(get_env_or_default FIRECRAWL_PORT 53002)"
      upsert_env QDRANT_URL "http://localhost:$(get_env_or_default QDRANT_REST_PORT 53333)"
      upsert_env AXON_EMBEDDER_QDRANT_URL "http://axon-qdrant:6333"

      local remote_tei_default
      remote_tei_default="$(get_env_or_default TEI_URL http://100.74.16.82:52000)"
      upsert_env TEI_URL "$(prompt_input "Remote TEI URL" "$remote_tei_default")"
      ;;

    external-firecrawl)
      DEPLOY_LOCAL_TEI=1
      EXPECT_LOCAL_FIRECRAWL=0
      EXPECT_LOCAL_EMBEDDER=1
      EXPECT_LOCAL_QDRANT=1
      EXPECT_LOCAL_TEI=1
      MAIN_SERVICES=(axon-embedder axon-qdrant)

      select_tei_profile
      prepare_local_tei_env

      local firecrawl_api_url_default
      firecrawl_api_url_default="$(get_env_or_default FIRECRAWL_API_URL https://api.firecrawl.dev)"
      local firecrawl_api_url
      local embedder_firecrawl_url
      firecrawl_api_url="$(prompt_input "Firecrawl API URL (self-hosted or cloud)" "$firecrawl_api_url_default")"
      embedder_firecrawl_url="$(to_container_reachable_url "$firecrawl_api_url")"
      upsert_env FIRECRAWL_API_URL "$firecrawl_api_url"
      upsert_env AXON_EMBEDDER_FIRECRAWL_API_URL "$embedder_firecrawl_url"
      upsert_env QDRANT_URL "http://localhost:$(get_env_or_default QDRANT_REST_PORT 53333)"
      upsert_env AXON_EMBEDDER_QDRANT_URL "http://axon-qdrant:6333"
      ;;

    external-vector)
      DEPLOY_LOCAL_TEI=0
      EXPECT_LOCAL_FIRECRAWL=0
      EXPECT_LOCAL_EMBEDDER=1
      EXPECT_LOCAL_QDRANT=0
      EXPECT_LOCAL_TEI=0
      MAIN_SERVICES=(axon-embedder)

      local ext_firecrawl_default
      local ext_qdrant_default
      local ext_tei_default
      local ext_firecrawl_url
      local ext_qdrant_url
      local ext_tei_url
      local ext_embedder_firecrawl_url
      local ext_embedder_qdrant_url
      ext_firecrawl_default="$(get_env_or_default FIRECRAWL_API_URL https://api.firecrawl.dev)"
      ext_qdrant_default="$(get_env_or_default QDRANT_URL http://localhost:6333)"
      ext_tei_default="$(get_env_or_default TEI_URL http://localhost:53020)"

      ext_firecrawl_url="$(prompt_input "Firecrawl API URL (self-hosted or cloud)" "$ext_firecrawl_default")"
      ext_qdrant_url="$(prompt_input "External Qdrant URL" "$ext_qdrant_default")"
      ext_tei_url="$(prompt_input "External TEI URL" "$ext_tei_default")"
      ext_embedder_firecrawl_url="$(to_container_reachable_url "$ext_firecrawl_url")"
      ext_embedder_qdrant_url="$(to_container_reachable_url "$ext_qdrant_url")"

      upsert_env FIRECRAWL_API_URL "$ext_firecrawl_url"
      upsert_env AXON_EMBEDDER_FIRECRAWL_API_URL "$ext_embedder_firecrawl_url"
      upsert_env QDRANT_URL "$ext_qdrant_url"
      upsert_env AXON_EMBEDDER_QDRANT_URL "$ext_embedder_qdrant_url"
      upsert_env TEI_URL "$ext_tei_url"
      ;;

    *)
      die "Unsupported deployment mode: $DEPLOYMENT_MODE"
      ;;
  esac

  local key_default
  key_default="$(get_env_or_default FIRECRAWL_API_KEY local-dev)"
  if [[ "$DEPLOYMENT_MODE" == "external-firecrawl" || "$DEPLOYMENT_MODE" == "external-vector" ]]; then
    key_default="$(prompt_input "Firecrawl API key" "$key_default")"
    upsert_env FIRECRAWL_API_KEY "$key_default"
  fi

  log "Selected deployment mode: $DEPLOYMENT_MODE"
  if [[ "$DEPLOY_LOCAL_TEI" -eq 1 ]]; then
    log "Local TEI profile: $TEI_PROFILE"
  fi
}

adjust_ports_if_needed() {
  local running_count
  if [[ "$DRY_RUN" -eq 1 ]]; then
    running_count="0"
    log "[dry-run] assuming no running Axon services for port reassignment check"
  else
    running_count="$(docker compose ps --services --status running 2>/dev/null | wc -l | tr -d ' ')"
  fi

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

  run_cmd mkdir -p "$(dirname "$link")"
  if [[ -e "$link" && ! -L "$link" ]]; then
    ts="$(date +%Y%m%d%H%M%S)"
    run_cmd mv "$link" "${link}.bak.${ts}"
  fi
  run_cmd ln -sfn "$target" "$link"
}

install_cli_links() {
  local repo="$1"
  local target
  for target in "${SELECTED_LINK_TARGETS[@]}"; do
    case "$target" in
      claude)
        link_path "$repo/commands" "$HOME/.claude/commands/axon"
        link_path "$repo/skills/axon" "$HOME/.claude/skills/axon"
        ;;
      codex)
        link_path "$repo/skills/axon" "$HOME/.codex/skills/axon"
        ;;
      gemini)
        link_path "$repo/skills/axon" "$HOME/.gemini/skills/axon"
        ;;
      opencode)
        link_path "$repo/skills/axon" "$HOME/.config/opencode/skills/axon"
        ;;
      *)
        warn "Unknown selected CLI target '$target'; skipping"
        ;;
    esac
  done

  if [[ ${#SELECTED_LINK_TARGETS[@]} -gt 0 ]]; then
    log "Installed links for CLI targets: $(IFS=,; echo "${SELECTED_LINK_TARGETS[*]}")"
  fi
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempts=30
  local delay_seconds=2
  local i

  for ((i=1; i<=attempts; i++)); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      log "Health OK: $name ($url)"
      return 0
    fi
    sleep "$delay_seconds"
  done

  warn "Health check timed out: $name ($url)"
  return 1
}

verify_deployment_health() {
  local firecrawl_port
  local embedder_port
  local qdrant_port
  local tei_url
  local failed=0

  firecrawl_port="$(get_env_or_default FIRECRAWL_PORT 53002)"
  embedder_port="$(get_env_or_default AXON_EMBEDDER_WEBHOOK_PORT 53000)"
  qdrant_port="$(get_env_or_default QDRANT_REST_PORT 53333)"
  tei_url="$(get_env_or_default TEI_URL http://localhost:53020)"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] would verify container states with docker compose ps"
    if [[ "$EXPECT_LOCAL_EMBEDDER" -eq 1 ]]; then
      log "[dry-run] would probe http://127.0.0.1:${embedder_port}/health"
    fi
    if [[ "$EXPECT_LOCAL_QDRANT" -eq 1 ]]; then
      log "[dry-run] would probe http://127.0.0.1:${qdrant_port}/collections"
    fi
    if [[ "$EXPECT_LOCAL_FIRECRAWL" -eq 1 ]]; then
      log "[dry-run] would probe TCP 127.0.0.1:${firecrawl_port}"
    fi
    if [[ "$EXPECT_LOCAL_TEI" -eq 1 ]]; then
      log "[dry-run] would probe ${tei_url}/health"
    fi
    return 0
  fi

  if ! docker compose ps --status running >/dev/null 2>&1; then
    warn "Unable to read running service state from docker compose"
    failed=1
  fi

  if [[ "$EXPECT_LOCAL_EMBEDDER" -eq 1 ]]; then
    wait_for_http "http://127.0.0.1:${embedder_port}/health" "axon-embedder" || failed=1
  fi

  if [[ "$EXPECT_LOCAL_QDRANT" -eq 1 ]]; then
    wait_for_http "http://127.0.0.1:${qdrant_port}/collections" "axon-qdrant" || failed=1
  fi

  if [[ "$EXPECT_LOCAL_FIRECRAWL" -eq 1 ]]; then
    if ! timeout 3 bash -c "</dev/tcp/127.0.0.1/${firecrawl_port}" 2>/dev/null; then
      warn "Health check timed out: firecrawl API TCP on port ${firecrawl_port}"
      failed=1
    else
      log "Health OK: firecrawl API TCP ${firecrawl_port}"
    fi
  fi

  if [[ "$EXPECT_LOCAL_TEI" -eq 1 ]]; then
    wait_for_http "${tei_url}/health" "tei" || failed=1
  fi

  if [[ "$failed" -ne 0 ]]; then
    warn "One or more health checks failed. Run: docker compose ps && docker compose logs --tail 100"
    return 1
  fi

  log "All deployment health checks passed"
}

check_docker_ready

set_default_ports
configure_secrets
configure_deployment_mode

if [[ "$SKIP_LINKS" -eq 0 ]]; then
  choose_cli_targets
fi

validate_env_configuration
validate_compose_configuration

if [[ "$SKIP_DOCKER" -eq 0 && "$SKIP_HEALTH_CHECK" -eq 0 ]]; then
  require_cmd curl
fi

if [[ "$SKIP_PORT_CHECK" -eq 0 ]]; then
  adjust_ports_if_needed
fi

if [[ "$SKIP_LINKS" -eq 0 ]]; then
  install_cli_links "$REPO_DIR"
fi

if [[ "$SKIP_DOCKER" -eq 0 ]]; then
  log "Deploying Axon Docker stack"
  if [[ ${#MAIN_SERVICES[@]} -gt 0 ]]; then
    run_cmd docker compose pull --ignore-pull-failures "${MAIN_SERVICES[@]}"
    run_cmd docker compose up -d --build "${MAIN_SERVICES[@]}"
    run_cmd docker compose ps "${MAIN_SERVICES[@]}"
  else
    run_cmd docker compose pull --ignore-pull-failures
    run_cmd docker compose up -d --build
    run_cmd docker compose ps
  fi

  if [[ "$DEPLOY_LOCAL_TEI" -eq 1 ]]; then
    log "Deploying local TEI stack (${TEI_PROFILE})"
    run_cmd docker compose --env-file "$TEI_ENV_FILE" -f "$TEI_COMPOSE_FILE" pull --ignore-pull-failures
    run_cmd docker compose --env-file "$TEI_ENV_FILE" -f "$TEI_COMPOSE_FILE" up -d
    run_cmd docker compose --env-file "$TEI_ENV_FILE" -f "$TEI_COMPOSE_FILE" ps
  fi

  if [[ "$SKIP_HEALTH_CHECK" -eq 0 ]]; then
    verify_deployment_health || die "Deployment health checks failed"
  fi
fi

log "Install complete"
log "Repo: $REPO_DIR"
log "Environment: $REPO_DIR/.env"
if [[ "$DEPLOY_LOCAL_TEI" -eq 1 ]]; then
  log "TEI env file: $REPO_DIR/$TEI_ENV_FILE"
fi
log "Try: axon doctor --json --pretty"
