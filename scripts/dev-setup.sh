#!/usr/bin/env bash
# dev-setup.sh — Bootstrap a new development environment for axon.
# Idempotent: safe to re-run. Checks before installing.
# Usage: ./scripts/dev-setup.sh [--build] [--no-docker]
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$(realpath "${BASH_SOURCE[0]}")")" && pwd -P)"
REPO="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

# ── Flags ──────────────────────────────────────────────────────────────────────
BUILD=false
NO_DOCKER=false
for arg in "$@"; do
  case "$arg" in
    --build)     BUILD=true ;;
    --no-docker) NO_DOCKER=true ;;
    --help|-h)
      echo "Usage: $0 [--build] [--no-docker]"
      echo "  --build      Also compile the release binary after setup"
      echo "  --no-docker  Skip starting Docker infrastructure"
      exit 0 ;;
    *) echo "[dev-setup] Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────
info()  { echo "[dev-setup] $*"; }
warn()  { echo "[dev-setup] WARN: $*" >&2; }
die()   { echo "[dev-setup] ERROR: $*" >&2; exit 1; }
ok()    { echo "[dev-setup] OK: $*"; }
sep()   { echo "[dev-setup] ────────────────────────────────────────"; }

# ── OS Detection ───────────────────────────────────────────────────────────────
sep
info "Detecting OS..."
case "$(uname -s)" in
  Linux*)  OS=linux ;;
  Darwin*) OS=macos ;;
  *)       die "Unsupported OS: $(uname -s). Only Linux and macOS are supported." ;;
esac
ok "OS: $OS"

pkg_install() {
  # pkg_install <pkg...>
  if [[ "$OS" == "macos" ]]; then
    brew install "$@"
  else
    sudo apt-get install -y "$@"
  fi
}

need() {
  # need <tool> [pkg-name-override]
  local tool="$1" pkg="${2:-$1}"
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool found: $(command -v "$tool")"
  else
    info "Installing $tool..."
    pkg_install "$pkg"
    ok "$tool installed"
  fi
}

# ── System Prerequisites ───────────────────────────────────────────────────────
sep
info "Checking system prerequisites..."

if [[ "$OS" == "macos" ]] && ! command -v brew >/dev/null 2>&1; then
  die "Homebrew is required on macOS. Install from https://brew.sh then re-run."
fi

need curl
need git
need python3
need jq

# ── Docker ─────────────────────────────────────────────────────────────────────
sep
info "Checking Docker..."
if ! command -v docker >/dev/null 2>&1; then
  die "Docker is not installed. Install Docker Desktop (https://docs.docker.com/get-docker/) then re-run."
fi
if ! docker info >/dev/null 2>&1; then
  die "Docker daemon is not running (or WSL integration is not enabled).\nStart Docker Desktop and ensure WSL integration is on, then re-run."
fi
if ! docker compose version >/dev/null 2>&1; then
  die "docker compose (v2 plugin) not found. Update Docker Desktop or install the compose plugin."
fi
ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
ok "Docker Compose $(docker compose version --short)"

# ── Rust Toolchain ─────────────────────────────────────────────────────────────
sep
info "Checking Rust toolchain..."
REQUIRED_RUST="$(grep '^channel' "$REPO/rust-toolchain.toml" | sed 's/.*"\(.*\)"/\1/')"

if ! command -v rustup >/dev/null 2>&1; then
  info "rustup not found — installing..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --no-modify-path --default-toolchain "$REQUIRED_RUST"
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
  ok "rustup installed"
else
  ok "rustup found"
  # shellcheck source=/dev/null
  [[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
fi

if ! rustup toolchain list | grep -q "$REQUIRED_RUST"; then
  info "Installing Rust $REQUIRED_RUST..."
  rustup toolchain install "$REQUIRED_RUST" --component rustfmt clippy
fi

ACTIVE_RUST="$(rustc --version 2>/dev/null | awk '{print $2}' || echo "none")"
ok "Rust $ACTIVE_RUST (required: $REQUIRED_RUST)"

rustup component add rustfmt clippy --toolchain "$REQUIRED_RUST" 2>/dev/null || true

# ── Optional Rust Dev Tools ────────────────────────────────────────────────────
sep
info "Checking optional Rust dev tools..."

cargo_install_if_missing() {
  local bin="$1" crate="${2:-$1}"
  if command -v "$bin" >/dev/null 2>&1; then
    ok "$bin already installed"
  else
    info "Installing $crate (optional)..."
    cargo install --locked "$crate" && ok "$crate installed" || warn "$crate install failed — skipping"
  fi
}

# Required for Justfile targets.
# NOTE: if just is not yet installed, run ./scripts/dev-setup.sh directly —
# `just setup` is a convenience alias for when just is already available.
if ! command -v just >/dev/null 2>&1; then
  info "Installing just (task runner)..."
  if [[ "$OS" == "macos" ]]; then
    brew install just && ok "just $(just --version)"
  else
    # Prebuilt binary is much faster than cargo install
    local _just_ver
    _just_ver="$(curl -fsSL https://api.github.com/repos/casey/just/releases/latest \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])")"
    curl -fsSL "https://github.com/casey/just/releases/download/${_just_ver}/just-${_just_ver}-x86_64-unknown-linux-musl.tar.gz" \
      | tar -xz -C "$HOME/.cargo/bin" just \
      && ok "just ${_just_ver} installed" \
      || { warn "prebuilt install failed — falling back to cargo install just"; cargo install --locked just && ok "just installed"; }
  fi
else
  ok "just $(just --version)"
fi

# Required for pre-commit hooks
if ! command -v lefthook >/dev/null 2>&1; then
  info "Installing lefthook (git hooks)..."
  cargo install --locked lefthook && ok "lefthook installed" \
    || warn "lefthook install failed — install manually: cargo install lefthook"
else
  ok "lefthook $(lefthook version 2>/dev/null || echo 'found')"
fi

cargo_install_if_missing cargo-nextest
cargo_install_if_missing cargo-watch
cargo_install_if_missing sccache

if command -v mold >/dev/null 2>&1; then
  ok "mold $(mold --version | head -1)"
else
  warn "mold not found (optional fast linker) — install via: sudo apt-get install mold  OR  brew install mold"
fi

# ── Node.js + pnpm ─────────────────────────────────────────────────────────────
sep
info "Checking Node.js..."
REQUIRED_NODE_MAJOR=24

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node --version | tr -d 'v' | cut -d. -f1)"
  if (( NODE_MAJOR >= REQUIRED_NODE_MAJOR )); then
    ok "Node.js $(node --version)"
  else
    warn "Node.js $(node --version) is below required v${REQUIRED_NODE_MAJOR}.x"
    if [[ "$OS" == "macos" ]]; then
      info "Run: brew install node@${REQUIRED_NODE_MAJOR} && brew link node@${REQUIRED_NODE_MAJOR} --force --overwrite"
    else
      info "Install via nvm: nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}"
      info "Or via NodeSource: curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | sudo -E bash - && sudo apt-get install -y nodejs"
    fi
    warn "Continuing — pnpm install may fail if Node version is incompatible."
  fi
else
  if [[ "$OS" == "macos" ]]; then
    info "Installing Node.js ${REQUIRED_NODE_MAJOR} via brew..."
    brew install "node@${REQUIRED_NODE_MAJOR}" && \
      brew link "node@${REQUIRED_NODE_MAJOR}" --force --overwrite && \
      ok "Node.js installed"
  else
    die "Node.js not found. Install via nvm (recommended):\n  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/HEAD/install.sh | bash\n  source ~/.nvm/nvm.sh && nvm install ${REQUIRED_NODE_MAJOR}"
  fi
fi

info "Checking pnpm..."
if command -v pnpm >/dev/null 2>&1; then
  PNPM_MAJOR="$(pnpm --version | cut -d. -f1)"
  if (( PNPM_MAJOR >= 10 )); then
    ok "pnpm $(pnpm --version)"
  else
    info "Upgrading pnpm to v10+..."
    npm install -g pnpm@10 && ok "pnpm upgraded to $(pnpm --version)"
  fi
else
  info "Installing pnpm v10..."
  npm install -g pnpm@10 && ok "pnpm $(pnpm --version) installed"
fi

# ── Web App Dependencies ───────────────────────────────────────────────────────
sep
info "Installing web app dependencies..."
(cd "$REPO/apps/web" && pnpm install --frozen-lockfile)
ok "apps/web dependencies installed"

# ── Environment File ───────────────────────────────────────────────────────────
sep
info "Checking .env..."
if [[ -f "$REPO/.env" ]]; then
  ok ".env already exists — skipping copy"
else
  cp "$REPO/.env.example" "$REPO/.env"
  ok ".env created from .env.example"

  # Prompt for AXON_DATA_DIR
  DEFAULT_DATA_DIR="$HOME/.local/share/axon"
  if [[ -t 0 ]]; then
    echo ""
    echo "  AXON_DATA_DIR — root directory for all persistent data (Postgres, Qdrant, etc.)"
    echo "  Press Enter to accept the default."
    read -r -p "  AXON_DATA_DIR [${DEFAULT_DATA_DIR}]: " USER_DATA_DIR
    AXON_DATA_DIR="${USER_DATA_DIR:-$DEFAULT_DATA_DIR}"
  else
    AXON_DATA_DIR="$DEFAULT_DATA_DIR"
    info "Non-interactive mode: AXON_DATA_DIR=${AXON_DATA_DIR}"
  fi

  # Expand ~ if the user typed it
  AXON_DATA_DIR="${AXON_DATA_DIR/#\~/$HOME}"

  # Write into .env (replace the placeholder line)
  sed -i "s|^AXON_DATA_DIR=.*|AXON_DATA_DIR=${AXON_DATA_DIR}|" "$REPO/.env"
  mkdir -p "$AXON_DATA_DIR"
  ok "AXON_DATA_DIR=${AXON_DATA_DIR}"

  # ── Generate secrets ─────────────────────────────────────────────────────────
  info "Generating secrets..."
  gen_secret() { python3 -c "import secrets; print(secrets.token_urlsafe(32))"; }

  PG_PASS="$(gen_secret)"
  REDIS_PASS="$(gen_secret)"
  RABBIT_PASS="$(gen_secret)"
  WEB_TOKEN="$(gen_secret)"

  set_env() {
    # set_env KEY VALUE  — replace or append in .env
    local key="$1" val="$2"
    if grep -q "^${key}=" "$REPO/.env"; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$REPO/.env"
    else
      echo "${key}=${val}" >> "$REPO/.env"
    fi
  }

  # Standalone password vars
  set_env POSTGRES_PASSWORD   "$PG_PASS"
  set_env REDIS_PASSWORD      "$REDIS_PASS"
  set_env RABBITMQ_PASS       "$RABBIT_PASS"

  # Connection URLs — rewrite with the generated passwords
  set_env AXON_PG_URL    "postgresql://axon:${PG_PASS}@axon-postgres:5432/axon"
  set_env AXON_REDIS_URL "redis://:${REDIS_PASS}@axon-redis:6379"
  set_env AXON_AMQP_URL  "amqp://axon:${RABBIT_PASS}@axon-rabbitmq:5672"

  # Web API token — client and server copies must match
  set_env AXON_WEB_API_TOKEN          "$WEB_TOKEN"
  set_env NEXT_PUBLIC_AXON_API_TOKEN  "$WEB_TOKEN"

  ok "Secrets generated and written to .env"

  # ── Test infrastructure URLs (static — matches docker-compose.test.yaml) ──────
  set_env AXON_TEST_PG_URL   "postgresql://axon:axontest@127.0.0.1:53434/axon_test"
  set_env AXON_TEST_AMQP_URL "amqp://axon:axontest@127.0.0.1:45536/%2f"
  set_env AXON_TEST_REDIS_URL  "redis://127.0.0.1:53380"
  set_env AXON_TEST_QDRANT_URL "http://127.0.0.1:53335"
  ok "Test service URLs written to .env"

  # ── Create data directories for container volume mounts ──────────────────────
  info "Creating data directories under ${AXON_DATA_DIR}..."
  mkdir -p \
    "${AXON_DATA_DIR}/axon/postgres" \
    "${AXON_DATA_DIR}/axon/redis" \
    "${AXON_DATA_DIR}/axon/rabbitmq" \
    "${AXON_DATA_DIR}/axon/qdrant" \
    "${AXON_DATA_DIR}/axon/output" \
    "${AXON_DATA_DIR}/axon/artifacts"
  ok "Data directories created"
fi

CHANGE_ME_COUNT="$(grep -c 'CHANGE_ME' "$REPO/.env" || true)"
if (( CHANGE_ME_COUNT > 0 )); then
  warn "$CHANGE_ME_COUNT value(s) in .env still need manual configuration:"
  grep -n 'CHANGE_ME' "$REPO/.env" | sed 's/^/  /' >&2
fi

# ── Docker Infrastructure ──────────────────────────────────────────────────────
if [[ "$NO_DOCKER" == "false" ]]; then
  sep
  info "Starting Docker infrastructure..."
  (cd "$REPO" && docker compose up -d \
    axon-postgres axon-redis axon-rabbitmq axon-qdrant axon-chrome)

  info "Starting test infrastructure..."
  if command -v just >/dev/null 2>&1; then
    (cd "$REPO" && just test-infra-up)
  else
    (cd "$REPO" && docker compose -f docker-compose.test.yaml up -d)
  fi

  # Wait for Postgres to be ready
  info "Waiting for Postgres..."
  for i in $(seq 1 30); do
    if (cd "$REPO" && docker compose exec -T axon-postgres \
        pg_isready -U axon >/dev/null 2>&1); then
      ok "Postgres is ready"
      break
    fi
    if (( i == 30 )); then
      warn "Postgres did not become ready after 30s — check: docker compose logs axon-postgres"
    fi
    sleep 1
  done

  info "Waiting for test Postgres..."
  for i in $(seq 1 30); do
    if (cd "$REPO" && docker compose -f docker-compose.test.yaml exec -T axon-postgres-test \
        pg_isready -U axon >/dev/null 2>&1); then
      ok "Test Postgres is ready"
      break
    fi
    if (( i == 30 )); then
      warn "Test Postgres did not become ready after 30s — check: docker compose -f docker-compose.test.yaml logs axon-postgres-test"
    fi
    sleep 1
  done

  ok "Infrastructure containers:"
  (cd "$REPO" && docker compose ps --format "  {{.Name}}: {{.Status}}" \
    axon-postgres axon-redis axon-rabbitmq axon-qdrant axon-chrome 2>/dev/null \
    || docker compose ps axon-postgres axon-redis axon-rabbitmq axon-qdrant axon-chrome)

  ok "Test infrastructure containers:"
  (cd "$REPO" && docker compose -f docker-compose.test.yaml ps --format "  {{.Name}}: {{.Status}}" 2>/dev/null \
    || docker compose -f docker-compose.test.yaml ps)
fi

# ── Git Hooks ──────────────────────────────────────────────────────────────────
sep
info "Installing git hooks..."
if command -v lefthook >/dev/null 2>&1; then
  "$REPO/scripts/install-git-hooks.sh"
else
  warn "lefthook not found — skipping git hooks. Install lefthook and run: ./scripts/install-git-hooks.sh"
fi

# ── Optional: Build Rust Binary ────────────────────────────────────────────────
if [[ "$BUILD" == "true" ]]; then
  sep
  info "Building release binary..."
  (cd "$REPO" && cargo build --release --locked --bin axon)
  ok "Binary: $REPO/target/release/axon"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
sep
info "Done! Next steps:"
echo ""
echo "  1. Edit .env and fill in any remaining CHANGE_ME values"
echo "     Required for full functionality:"
echo "       TEI_URL           — text embedding service"
echo "       OPENAI_BASE_URL   — LLM endpoint (for ask/extract)"
echo "       OPENAI_API_KEY    — LLM API key"
echo "       OPENAI_MODEL      — LLM model name"
echo "       TAVILY_API_KEY    — for search/research commands"
echo ""
echo "  2. Run workers (each in its own terminal):"
echo "       cargo run --bin axon -- crawl worker"
echo "       cargo run --bin axon -- embed worker"
echo "       cargo run --bin axon -- extract worker"
echo "     Or all at once:  just workers"
echo ""
echo "  3. Run the web UI:"
echo "       cd apps/web && pnpm dev    # http://localhost:49010"
echo "     Or full dev stack:  just dev"
echo ""
echo "  4. Verify services:  ./scripts/axon doctor"
echo "  5. Run checks:       just verify"
echo "  6. Test infra:       just test-infra-up   # start"
echo "                       just test-infra-down  # stop + wipe data"
echo ""
