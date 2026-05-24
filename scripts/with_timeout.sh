#!/usr/bin/env bash
# Wall-clock wrapper. Kills the wrapped command after N seconds.
#
# Usage: with_timeout.sh <seconds> -- <command> [args...]
#
# Uses GNU `timeout` (Linux) or `gtimeout` (macOS via coreutils) when
# available. Falls back to a backgrounded watchdog so the wrapper still
# enforces the limit on systems with neither installed.
#
# Exit codes:
#   0       command succeeded within the budget
#   124     command exceeded the budget and was killed
#   other   command's own exit code

set -euo pipefail

if [ "$#" -lt 3 ] || [ "$2" != "--" ]; then
    echo "usage: $0 <seconds> -- <command> [args...]" >&2
    exit 2
fi

secs="$1"
shift 2

if command -v timeout >/dev/null 2>&1; then
    exec timeout "${secs}" "$@"
fi

if command -v gtimeout >/dev/null 2>&1; then
    exec gtimeout "${secs}" "$@"
fi

# Manual fallback: spawn the command and a watchdog. Whichever finishes
# first wins; if the watchdog wins, kill the command and exit 124.
"$@" &
cmd_pid=$!

(
    sleep "${secs}"
    kill -TERM "${cmd_pid}" 2>/dev/null || true
    sleep 1
    kill -KILL "${cmd_pid}" 2>/dev/null || true
) &
watchdog_pid=$!

set +e
wait "${cmd_pid}"
rc=$?
set -e

# Stop the watchdog if the command finished first.
kill -KILL "${watchdog_pid}" 2>/dev/null || true
wait "${watchdog_pid}" 2>/dev/null || true

# If the command was killed by SIGTERM (143) attribute it to the timeout.
if [ "${rc}" -eq 143 ]; then
    rc=124
fi
exit "${rc}"
