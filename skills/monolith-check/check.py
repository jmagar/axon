#!/usr/bin/env python3
"""Language-agnostic monolith size checker.

For Rust files, delegates to scripts/enforce_monoliths.py which also checks
function sizes against the project policy.

For all other languages, checks file line counts only (no AST parsing).

Usage:
  python3 skills/monolith-check/check.py [--staged] [--all] [--file PATH]
                                         [--file-max-lines N]
"""

from __future__ import annotations

import argparse
import fnmatch
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENFORCER = REPO_ROOT / "scripts" / "enforce_monoliths.py"
ALLOWLIST_FILE = REPO_ROOT / ".monolith-allowlist"

DEFAULT_FILE_MAX_LINES = 500

# Extensions with known function parsers in enforce_monoliths.py
RUST_EXTENSIONS = {".rs"}

# Extensions to check for file size (everything reasonable)
CHECKABLE_EXTENSIONS = {
    ".rs", ".py", ".ts", ".tsx", ".js", ".jsx",
    ".go", ".java", ".kt", ".swift", ".cpp", ".c", ".h",
    ".sh", ".bash", ".zsh",
}

EXCLUDED_GLOBS = [
    "config/**", "**/config/**", "**/config.rs",
    "tests/**", "**/tests/**",
    "**/*_test.*", "**/*_tests.*",
    "**/*.test.*", "**/*.spec.*",
    "benches/**",
    "target/**", "node_modules/**", ".venv/**",
    "*.lock", "*.toml",
]


def load_allowlist() -> set[str]:
    if not ALLOWLIST_FILE.exists():
        return set()
    allowed: set[str] = set()
    for raw in ALLOWLIST_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            allowed.add(line)
    return allowed


def is_excluded(path: str, allowlist: set[str]) -> bool:
    if path in allowlist:
        return True
    return any(fnmatch.fnmatch(path, p) for p in EXCLUDED_GLOBS)


def run_git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def staged_files() -> list[str]:
    out = run_git(["diff", "--cached", "--name-only"])
    return [
        p.strip() for p in out.splitlines()
        if p.strip() and (REPO_ROOT / p.strip()).is_file()
    ]


def all_tracked_files() -> list[str]:
    out = run_git(["ls-files"])
    return [
        p.strip() for p in out.splitlines()
        if p.strip() and (REPO_ROOT / p.strip()).is_file()
    ]


def count_lines(path: Path) -> int:
    try:
        return len(path.read_text(encoding="utf-8", errors="ignore").splitlines())
    except OSError:
        return 0


def check_non_rust_files(
    files: list[str], allowlist: set[str], file_max: int
) -> tuple[list[str], list[str]]:
    """Check non-Rust files for file-level size violations only."""
    violations: list[str] = []
    skipped: list[str] = []

    for path in files:
        full = REPO_ROOT / path
        if full.suffix not in CHECKABLE_EXTENSIONS:
            continue
        if full.suffix in RUST_EXTENSIONS:
            continue  # Rust handled separately
        if is_excluded(path, allowlist):
            skipped.append(path)
            continue

        n = count_lines(full)
        if n > file_max:
            violations.append(f"FILE {path}: {n} lines (limit {file_max})")

    return violations, skipped


def run_rust_enforcer(mode: str, file_max: int, extra: list[str] | None = None) -> int:
    """Delegate Rust checking to the existing enforcer."""
    if not ENFORCER.exists():
        print(f"[monolith-check] Rust enforcer not found at {ENFORCER}", file=sys.stderr)
        return 2

    cmd = [
        sys.executable, str(ENFORCER),
        f"--file-max-lines={file_max}",
    ]
    if mode == "--staged":
        cmd.append("--staged")
    elif mode == "--all":
        # pass HEAD~1..HEAD as a proxy for "everything" — enforcer needs base+head
        cmd += ["--base", "HEAD~1", "--head", "HEAD"]
    if extra:
        cmd.extend(extra)

    result = subprocess.run(cmd, cwd=REPO_ROOT)
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Language-agnostic monolith checker")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--staged", action="store_true", help="Check staged files only")
    mode.add_argument("--all", action="store_true", help="Check all tracked files")
    mode.add_argument("--file", metavar="PATH", help="Check a single file")
    parser.add_argument("--file-max-lines", type=int, default=DEFAULT_FILE_MAX_LINES)
    args = parser.parse_args()

    # Default: staged
    if not args.staged and not args.all and not args.file:
        args.staged = True

    file_max = args.file_max_lines
    allowlist = load_allowlist()
    all_violations: list[str] = []
    rust_rc = 0

    if args.file:
        # Single-file mode
        path = Path(args.file)
        rel = str(path.relative_to(REPO_ROOT)) if path.is_absolute() else args.file
        files = [rel]

        if path.suffix in RUST_EXTENSIONS:
            # Write a temp staged check isn't practical for a single file;
            # just do file-line-count and note function check needs --staged/--all
            n = count_lines(REPO_ROOT / rel)
            if n > file_max:
                all_violations.append(f"FILE {rel}: {n} lines (limit {file_max})")
            else:
                print(f"FILE {rel}: {n} lines (OK)")
            print("Note: function-size checks require --staged or --all (Rust only)")
        else:
            violations, _ = check_non_rust_files(files, allowlist, file_max)
            all_violations.extend(violations)
            if not violations:
                n = count_lines(REPO_ROOT / rel)
                print(f"FILE {rel}: {n} lines (OK)")

    elif args.staged:
        files = staged_files()
        if not files:
            print("[monolith-check] No staged files.")
            return 0

        rust_files = [f for f in files if Path(f).suffix in RUST_EXTENSIONS]
        other_files = [f for f in files if Path(f).suffix not in RUST_EXTENSIONS]

        if rust_files:
            print(f"[Rust] checking {len(rust_files)} staged .rs file(s)...")
            rust_rc = run_rust_enforcer("--staged", file_max)

        if other_files:
            print(f"[Other] checking {len(other_files)} staged non-Rust file(s)...")
            violations, _ = check_non_rust_files(other_files, allowlist, file_max)
            all_violations.extend(violations)

    else:  # --all
        files = all_tracked_files()
        rust_files = [f for f in files if Path(f).suffix in RUST_EXTENSIONS]
        other_files = [f for f in files if Path(f).suffix not in RUST_EXTENSIONS]

        if rust_files:
            print(f"[Rust] checking {len(rust_files)} tracked .rs file(s)...")
            rust_rc = run_rust_enforcer("--all", file_max)

        if other_files:
            print(f"[Other] checking {len(other_files)} tracked non-Rust file(s)...")
            violations, _ = check_non_rust_files(other_files, allowlist, file_max)
            all_violations.extend(violations)

    if all_violations:
        print("\nMonolith policy violations (non-Rust):")
        for v in all_violations:
            print(f"  - {v}")
        print("\nAdd exceptions to .monolith-allowlist if necessary.")

    if rust_rc != 0 or all_violations:
        return 1

    if not all_violations and rust_rc == 0:
        print("Monolith policy check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
