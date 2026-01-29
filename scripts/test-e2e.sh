#!/bin/bash
# Load .env and run e2e tests

set -a
source .env 2>/dev/null || true
set +a

pnpm test:e2e "$@"
