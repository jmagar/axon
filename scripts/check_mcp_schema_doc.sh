#!/usr/bin/env bash
# Verify docs/MCP-TOOL-SCHEMA.md is in sync with src/mcp/schema.rs.
#
# Previously this ran the generator inside the pre-commit hook and silently
# `git add`ed the regenerated doc into the in-flight commit. That's
# convenient but commonly causes "wait why is that file in my commit"
# surprises and hides drift from review.
#
# Now: regenerate into a temp area, diff against the committed version,
# fail with a clear instruction if they differ. Developers run the
# generator themselves and stage the result.
#
# The generator (scripts/generate_mcp_schema_doc.py) has no `--check`
# mode and writes to DOC_PATH unconditionally, so this script backs up
# DOC_PATH first and restores it on EVERY exit (success, error, signal)
# via a trap. That keeps the developer's working tree pristine no
# matter how the generator behaves.

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

tmp_dir="$(mktemp -d)"
backup="${tmp_dir}/original.md"
regen="${tmp_dir}/regenerated.md"

cp "${DOC_PATH}" "${backup}"

# Always restore the working tree on exit. The generator writes to
# DOC_PATH in place, so anything that interrupts us between the
# generator call and a successful restore would otherwise leak a
# regenerated file the developer didn't author. The trap covers
# every exit path including SIGINT/SIGTERM and `set -e` aborts.
restore() {
    local rc=$?
    cp "${backup}" "${DOC_PATH}" 2>/dev/null || true
    rm -rf "${tmp_dir}"
    exit "${rc}"
}
trap restore EXIT INT TERM

python3 "${GEN_SCRIPT}" >/dev/null
cp "${DOC_PATH}" "${regen}"
# DOC_PATH will be restored from ${backup} by the trap.

# The generator stamps today's date into a `Last Modified:` line; that
# line bumps on every regeneration and is not real drift. Strip it
# from both sides before comparing.
strip_volatile() {
    grep -v '^Last Modified:' "$1"
}

if diff -q <(strip_volatile "${regen}") <(strip_volatile "${backup}") >/dev/null 2>&1; then
    exit 0
fi

echo "ERROR ${DOC_PATH} is out of sync with src/mcp/schema.rs" >&2
echo "       Run: python3 ${GEN_SCRIPT} && git add ${DOC_PATH}" >&2
echo "" >&2
echo "       Diff (committed vs regenerated, ignoring Last Modified line):" >&2
diff -u <(strip_volatile "${backup}") <(strip_volatile "${regen}") | head -40 >&2 || true
exit 1
