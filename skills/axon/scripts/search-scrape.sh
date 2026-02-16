#!/bin/bash
# Script Name: search-scrape.sh
# Purpose: Search the web and scrape results with Axon
# Usage: ./search-scrape.sh <query> [limit]

set -euo pipefail

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
Usage: $0 <query> [limit]

Search the web and scrape content from results.

Arguments:
    query           Search query string
    limit           Optional: Maximum results to scrape (omit for unlimited)

Options:
    --help          Show this help message

Examples:
    $0 "AI agent benchmarks"            # No limit
    $0 "web scraping tutorials" 10      # Max 10 results
    $0 "latest AI research" 3           # Max 3 results

Environment Variables:
    FIRECRAWL_API_KEY    API key for Firecrawl cloud API
    FIRECRAWL_API_URL    Custom API endpoint (optional)

Output:
    JSON array of search results with scraped content

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
        echo "ERROR: Search query required" >&2
        usage
        exit 1
    fi

    local query="$1"
    local limit="${2:-}"

    # Validate limit is a number if provided
    if [[ -n "$limit" ]] && ! [[ "$limit" =~ ^[0-9]+$ ]]; then
        echo "ERROR: Limit must be a positive number" >&2
        exit 1
    fi

    # Build firecrawl command
    local -a cmd=(axon search "$query" --scrape --pretty)

    # Add limit only if provided
    if [[ -n "$limit" ]]; then
        cmd+=(--limit "$limit")
    fi

    # Add API key if set (cloud API)
    if [[ -n "${FIRECRAWL_API_KEY:-}" ]]; then
        cmd+=(--api-key "$FIRECRAWL_API_KEY")
    fi

    # Add custom API URL if set (self-hosted)
    if [[ -n "${FIRECRAWL_API_URL:-}" ]]; then
        cmd+=(--api-url "$FIRECRAWL_API_URL")
    fi

    # Execute command
    if [[ -n "$limit" ]]; then
        echo "Searching and scraping: $query (limit: $limit)" >&2
    else
        echo "Searching and scraping: $query (no limit)" >&2
    fi
    "${cmd[@]}"
}

main "$@"
