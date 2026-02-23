#!/usr/bin/env python3
"""Audit .env.example for drift, duplicates, and credential leaks.

Three checks run in sequence:

1. DUPLICATES — same key defined more than once in .env.example
2. DRIFT — env vars read by Rust code (env::var) missing from .env.example,
            or vars in .env.example no longer read by any code
3. CREDENTIAL LEAK — patterns that look like real secrets (ghp_, sk-, eyJ, etc.)

Exits 0 if all clean, 1 if any issues found, 2 on setup error.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_EXAMPLE = REPO_ROOT / ".env.example"

# Directories to scan for env::var() calls
RUST_DIRS = [REPO_ROOT / "crates", REPO_ROOT / "mod.rs", REPO_ROOT / "main.rs"]

# Vars that are legitimately in code but not worth documenting in .env.example
# (OS builtins, cargo builtins, test-only vars)
CODE_ONLY_ALLOWLIST = {
    "HOME",
    "PATH",
    "HOSTNAME",
    "CARGO_PKG_VERSION",
    "CARGO_PKG_NAME",
    "RUST_LOG",
    "RUST_BACKTRACE",
}

# Vars in .env.example that are not read by Rust env::var() but are still valid:
# compose credentials, spider-rs native vars, or intentional feature flags
# read by Docker/s6 entrypoints rather than the CLI binary.
COMPOSE_ONLY_ALLOWLIST = {
    # Docker Compose service credentials
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "REDIS_PASSWORD",
    "RABBITMQ_USER",
    "RABBITMQ_PASS",
    # Spider-rs reads these natively (not via our env::var calls)
    "CHROME_URL",
    # Read by Docker/s6 entrypoints or feature flags not yet wired to env::var
    "AXON_CHROME_DIAGNOSTICS",
    "AXON_CHROME_DIAGNOSTICS_EVENTS",
    "AXON_CHROME_DIAGNOSTICS_SCREENSHOT",
    "AXON_COLLECTION",
    "AXON_JOB_STALE_TIMEOUT_SECS",
    "AXON_JOB_STALE_CONFIRM_SECS",
}

# Patterns that suggest a real credential rather than a placeholder
CREDENTIAL_PATTERNS = [
    (r"ghp_[A-Za-z0-9]{36}", "GitHub personal access token (ghp_...)"),
    (r"ghs_[A-Za-z0-9]{36}", "GitHub app token (ghs_...)"),
    (r"sk-[A-Za-z0-9]{32,}", "OpenAI-style secret key (sk-...)"),
    (r"sk-ant-[A-Za-z0-9\-]{32,}", "Anthropic secret key (sk-ant-...)"),
    (r"eyJ[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+", "JWT token (eyJ...)"),
    (r"AKIA[A-Z0-9]{16}", "AWS access key (AKIA...)"),
    (r"tvly-[A-Za-z0-9]{32,}", "Tavily API key (tvly-...)"),
    (r"['\"]?[0-9a-f]{40}['\"]?", "40-char hex string (possible token/secret)"),
    (r"['\"]?[0-9a-f]{64}['\"]?", "64-char hex string (possible secret)"),
]

# Placeholder values that are explicitly safe (not real credentials)
PLACEHOLDER_VALUES = {
    "CHANGE_ME", "REPLACE_ME", "your-key-here", "your-model-name",
    "REPLACE_WITH_TEI_HOST", "REPLACE_WITH_OPENAI_BASE",
}


def parse_env_example(path: Path) -> tuple[dict[str, tuple[int, str]], list[tuple[int, str, str]]]:
    """Parse .env.example into {key: (line_no, value)} and list duplicates."""
    seen: dict[str, tuple[int, str]] = {}
    duplicates: list[tuple[int, str, str]] = []  # (line_no, key, first_seen)

    for i, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key or not key.replace("_", "").isalnum():
            continue
        if key in seen:
            duplicates.append((i, key, f"line {seen[key][0]}"))
        else:
            seen[key] = (i, value.strip())

    return seen, duplicates


def extract_rust_env_vars() -> set[str]:
    """Scan Rust source for env::var("VAR_NAME") calls."""
    pattern = re.compile(r'env::var\(\s*"([A-Z][A-Z0-9_]+)"\s*\)')
    found: set[str] = set()

    sources: list[Path] = []
    for entry in RUST_DIRS:
        if entry.is_file():
            sources.append(entry)
        elif entry.is_dir():
            sources.extend(entry.rglob("*.rs"))

    for path in sources:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
            found.update(pattern.findall(text))
        except OSError:
            pass

    return found


def check_credential_leak(env_keys: dict[str, tuple[int, str]]) -> list[str]:
    """Scan .env.example values for patterns that look like real credentials."""
    issues: list[str] = []
    compiled = [(re.compile(p), desc) for p, desc in CREDENTIAL_PATTERNS]

    for key, (line_no, value) in env_keys.items():
        if not value or value in PLACEHOLDER_VALUES:
            continue
        # Skip obviously safe placeholder-shaped values
        if any(p in value for p in ("CHANGE_ME", "REPLACE", "your-", "example", "localhost", "127.0.0.1")):
            continue
        for pat, desc in compiled:
            if pat.search(value):
                issues.append(f"  line {line_no}: {key}= — looks like a real {desc}")
                break

    return issues


def main() -> int:
    if not ENV_EXAMPLE.exists():
        print(f"ERROR: {ENV_EXAMPLE} not found", file=sys.stderr)
        return 2

    env_keys, duplicates = parse_env_example(ENV_EXAMPLE)
    rust_vars = extract_rust_env_vars()
    found_issues = False

    # ── 1. Duplicates ──────────────────────────────────────────────────────────
    if duplicates:
        found_issues = True
        print("DUPLICATES in .env.example:")
        for line_no, key, first in duplicates:
            print(f"  line {line_no}: {key} (first defined at {first})")
    else:
        print("Duplicates: none")

    # ── 2. Drift ───────────────────────────────────────────────────────────────
    documented = set(env_keys.keys())
    code_reads = rust_vars - CODE_ONLY_ALLOWLIST
    compose_only = COMPOSE_ONLY_ALLOWLIST

    missing_from_example = code_reads - documented - compose_only
    stale_in_example = documented - code_reads - compose_only

    if missing_from_example:
        found_issues = True
        print(f"\nMISSING from .env.example (code reads these, not documented):")
        for var in sorted(missing_from_example):
            print(f"  {var}")
    else:
        print("Drift (missing from .env.example): none")

    if stale_in_example:
        print(f"\nSTALE in .env.example (documented but no code reads them):")
        for var in sorted(stale_in_example):
            print(f"  {var}  [warn — may be compose-only or intentional]")
        # Stale is a warning, not a hard failure — compose vars live here too
    else:
        print("Drift (stale in .env.example): none")

    # ── 3. Credential leak ─────────────────────────────────────────────────────
    leaks = check_credential_leak(env_keys)
    if leaks:
        found_issues = True
        print("\nCREDENTIAL LEAK — possible real secret in .env.example:")
        for msg in leaks:
            print(msg)
        print("  Use placeholder values (CHANGE_ME, REPLACE_ME) — never commit real keys.")
    else:
        print("Credential leak: none")

    print()
    if found_issues:
        print(".env.example audit FAILED — fix issues above.")
        return 1

    print(".env.example audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
