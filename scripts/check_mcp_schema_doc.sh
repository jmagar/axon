#!/usr/bin/env bash
# Verify docs/MCP-TOOL-SCHEMA.md is in sync with src/mcp/schema.rs.
#
# Previously this ran the generator inside the pre-commit hook and silently
# `git add`ed the regenerated doc into the in-flight commit. That's
# convenient but commonly causes "wait why is that file in my commit"
# surprises and hides drift from review.
#
# Now: regenerate into a temp file, diff against the committed version,
# fail with a clear instruction if they differ. Developers run the
# generator themselves and stage the result.

set -euo pipefail

DOC_PATH="docs/MCP-TOOL-SCHEMA.md"
GEN_SCRIPT="scripts/generate_mcp_schema_doc.py"

if [ ! -f "${GEN_SCRIPT}" ]; then
    echo "ERROR ${GEN_SCRIPT} not found" >&2
    exit 1
fi
if [ ! -f "${DOC_PATH}" ]; then
    echo "ERROR ${DOC_PATH} not found — run: python3 ${GEN_SCRIPT}" >&2
    exit 1
fi

tmp_file="$(mktemp -t mcp-schema-doc.XXXXXX.md)"
trap 'rm -f "${tmp_file}"' EXIT

# The generator writes to ${DOC_PATH} directly; we shuffle it through
# the temp file so the committed doc is unchanged.
cp "${DOC_PATH}" "${tmp_file}.original"
python3 "${GEN_SCRIPT}" >/dev/null
cp "${DOC_PATH}" "${tmp_file}.regenerated"
cp "${tmp_file}.original" "${DOC_PATH}"

# The generator stamps today's date into a `Last Modified:` line; that
# line bumps on every regeneration and is not real drift. Strip it out
# of both sides before comparing.
strip_volatile() {
    grep -v '^Last Modified:' "$1"
}

if ! diff -q <(strip_volatile "${tmp_file}.regenerated") <(strip_volatile "${DOC_PATH}") >/dev/null 2>&1; then
    echo "ERROR ${DOC_PATH} is out of sync with src/mcp/schema.rs" >&2
    echo "       Run: python3 ${GEN_SCRIPT} && git add ${DOC_PATH}" >&2
    echo "" >&2
    echo "       Diff (committed vs regenerated, ignoring Last Modified line):" >&2
    diff -u <(strip_volatile "${DOC_PATH}") <(strip_volatile "${tmp_file}.regenerated") | head -40 >&2 || true
    rm -f "${tmp_file}.original" "${tmp_file}.regenerated"
    exit 1
fi

rm -f "${tmp_file}.original" "${tmp_file}.regenerated"
