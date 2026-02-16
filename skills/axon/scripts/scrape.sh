#!/bin/bash
# Script Name: scrape.sh
# Purpose: Scrape a single URL with Axon
# Usage: ./scrape.sh <url> [output-file]

set -euo pipefail

# === Configuration ===
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load environment variables from .env
ENV_FILE="$HOME/claude-homelab/.env"
if [[ -f "$ENV_FILE" ]]; then
    # Source .env file and export variables
    set -a
    source "$ENV_FILE"
    set +a
else
    echo "ERROR: .env file not found at $ENV_FILE" >&2
    exit 1
fi

# === Functions ===

usage() {
    cat <<EOF
Usage: $0 <url> [output-file]

Scrape a single URL and extract main content in markdown format.

Arguments:
    url             URL to scrape
    output-file     Optional: Save output to file instead of stdout

Options:
    --help          Show this help message

Examples:
    $0 https://example.com
    $0 https://example.com output.md
    $0 https://example.com --format markdown,html

Environment Variables:
    FIRECRAWL_API_KEY    API key for Firecrawl cloud API
    FIRECRAWL_API_URL    Custom API endpoint (optional)

EOF
}

# === Main Script ===

main() {
    # Check for help flag
    if [[ "${1:-}" == "--help" ]]; then
        usage
        exit 0
    fi

    # Validate arguments
    if [[ $# -lt 1 ]]; then
        echo "ERROR: URL required" >&2
        usage
        exit 1
    fi

    local url="$1"
    local output_file="${2:-}"

    # Validate URL format
    if [[ ! "$url" =~ ^https?:// ]]; then
        echo "ERROR: URL must start with http:// or https://" >&2
        exit 1
    fi

    # Build firecrawl command
    local -a cmd=(axon "$url" --only-main-content)

    # Add API key if set (cloud API)
    if [[ -n "${FIRECRAWL_API_KEY:-}" ]]; then
        cmd+=(--api-key "$FIRECRAWL_API_KEY")
    fi

    # Add custom API URL if set (self-hosted)
    if [[ -n "${FIRECRAWL_API_URL:-}" ]]; then
        cmd+=(--api-url "$FIRECRAWL_API_URL")
    fi

    # Add output file if provided
    if [[ -n "$output_file" ]]; then
        cmd+=(-o "$output_file")
    fi

    # Execute command
    "${cmd[@]}"
}

main "$@"
