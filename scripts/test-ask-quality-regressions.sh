#!/usr/bin/env bash
set -euo pipefail

# Ask-quality regression gate.
#
# The required test names are checked against one `cargo test -- --list`
# first. This closes the silent-pass hole: `cargo test <filter>` exits 0 when
# the filter matches nothing, so a renamed/deleted test would let the gate go
# green while asserting nothing.
#
# NOTE: four former filters were removed because their target tests/functions
# do not exist in the tree (they matched zero tests and were silently passing):
#   - ask_quality_regression_fixtures_five_queries
#   - procedural_query_requires_official_docs_citation
#   - config_schema_query_requires_exact_page_citation
#   - authoritative_allowlist_matches_exact_and_suffix_hosts
# These represent intended coverage (citation grounding, authoritative-host
# allowlisting, a five-query fixture set) that should be authored as a
# follow-up — together with the underlying allowlist/policy code they assert.
# Do NOT re-add a filter here until the matching test exists, or the guard
# will (correctly) fail the gate.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[ask-quality] Running regression fixtures and policy tests..."

mapfile -t REQUIRED_TESTS <<'TESTS'
normalize_ask_answer_dedupes_sources_by_url
normalize_ask_answer_formats_insufficient_evidence_when_uncited
normalize_ask_answer_formats_insufficient_evidence_when_flagged_in_body
non_trivial_answer_requires_minimum_citation_count
TESTS

LIST_OUTPUT="$(cargo test --locked -- --list)"
for test_name in "${REQUIRED_TESTS[@]}"; do
  if ! grep -Fq "${test_name}:" <<<"${LIST_OUTPUT}"; then
    echo "[ask-quality] required cargo test is missing: ${test_name}" >&2
    exit 1
  fi
done

cargo test -q --locked normalize_ask_answer
cargo test -q --locked non_trivial_answer_requires_minimum_citation_count

echo "[ask-quality] All regression checks passed."
