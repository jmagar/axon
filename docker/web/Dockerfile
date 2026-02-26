# syntax=docker/dockerfile:1
FROM node:24-slim

# Install system deps + AI CLIs as root into system paths
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Claude: installer drops binary into $HOME/.local/bin — run as root so it lands
# in /root/.local/bin, then promote to a system path for all users
RUN curl -fsSL https://claude.ai/install.sh | bash && \
    mv /root/.local/bin/claude /usr/local/bin/claude

# Codex + Gemini: npm -g installs directly to /usr/local/bin
RUN npm install -g @openai/codex@latest
RUN npm install -g @google/gemini-cli@latest

# corepack ships with Node 24 — use it to install pnpm without a separate npm call
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy dep manifests only — source is bind-mounted at runtime for hot reload
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Drop to non-root for runtime
USER node

# next dev binds to all interfaces when HOST=0.0.0.0 (set in docker-compose env)
CMD ["pnpm", "run", "dev"]
