#!/usr/bin/env python3
"""Standalone Qdrant collection quality checker."""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap
from typing import Any

from qdrant_quality_analysis import (
    analyze_domain_breakdown,
    analyze_exclude_sync,
    analyze_payload_schema,
    analyze_stale_data,
    check_collection,
    confirm_destructive_action,
    display_aliases_info,
    display_health_info,
)
from qdrant_quality_client import fetch_all_points, get_qdrant_url, list_collections, set_qdrant_url
from qdrant_quality_runtime import resolve_runtime_qdrant_url
from qdrant_quality_settings import (
    DEFAULT_COLLECTION,
    DEFAULT_EXCLUDE_PREFIXES,
    DEFAULT_QDRANT_URL,
    DOTENV_VALUES,
    normalize_exclude_prefixes,
    parse_csv_values,
)
from qdrant_quality_ui import accent, muted, primary, render_help_text, status_text


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="qdrant-quality.py",
        description="Qdrant collection quality toolkit for duplicate detection, exclusion audits, and cleanup.",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=textwrap.dedent(
            """\
            Examples:
              python3 scripts/qdrant-quality.py health
              python3 scripts/qdrant-quality.py check
              python3 scripts/qdrant-quality.py check --collection cortex
              python3 scripts/qdrant-quality.py check-all
              python3 scripts/qdrant-quality.py delete-duplicates --collection cortex
              python3 scripts/qdrant-quality.py delete-excluded --collection cortex
              python3 scripts/qdrant-quality.py check --exclude-path-prefix /fr,/de
              python3 scripts/qdrant-quality.py check --exclude-path-prefix none
            """
        ),
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_QDRANT_URL,
        help="Qdrant base URL. Defaults to env/.env QDRANT_URL, then runtime-aware local fallback.",
    )
    parser.add_argument(
        "--exclude-path-prefix",
        action="append",
        default=[],
        help=(
            "Path prefix exclusion override for audits.\n"
            "Repeat flag or use comma-separated values.\n"
            "Use 'none' to disable default language-prefix exclusions."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview delete actions without deleting points.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON output.",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=0,
        help="Limit scan to first N points (0 = full collection scan).",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip confirmation prompt for destructive commands.",
    )

    sub = parser.add_subparsers(
        dest="command",
        required=True,
        title="Commands",
        metavar="COMMAND",
        description="Run one of the following commands:",
    )

    sub.add_parser(
        "help",
        help="Show full help with command descriptions and examples",
        description="Print top-level help output.",
    )
    sub.add_parser(
        "health",
        help="Show cluster and collection health stats",
        description="Display Qdrant version plus per-collection point/vector/status metrics.",
    )
    sub.add_parser(
        "aliases",
        help="Audit aliases and flag dangling targets",
        description="List aliases and identify aliases pointing to missing collections.",
    )
    p_schema = sub.add_parser(
        "payload-schema",
        help="Audit payload field presence and types",
        description="Validate payload key presence/type rates for a collection.",
    )
    p_schema.add_argument("--collection", default=DEFAULT_COLLECTION)

    p_domains = sub.add_parser(
        "domain-breakdown",
        help="Show top domains by points and duplicate rates",
        description="Compute per-domain point counts and duplicate density.",
    )
    p_domains.add_argument("--collection", default=DEFAULT_COLLECTION)
    p_domains.add_argument("--top", type=int, default=20, help="Number of top domains to show.")

    p_stale = sub.add_parser(
        "stale-data",
        help="Check age of points using timestamps",
        description="Assess stale data rate based on scraped/file-modified timestamps.",
    )
    p_stale.add_argument("--collection", default=DEFAULT_COLLECTION)
    p_stale.add_argument("--days", type=int, default=90, help="Staleness threshold in days.")

    sub.add_parser(
        "strict-exclude-sync",
        help="Compare script/Rust default exclude prefixes",
        description="Detect drift between script defaults and Rust default_exclude_prefixes().",
    )

    p_check = sub.add_parser(
        "check",
        help="Audit one collection (quality, duplicates, exclusions, distribution)",
        description="Run full quality analysis for a single collection.",
    )
    p_check.add_argument("--collection", default=DEFAULT_COLLECTION)

    sub.add_parser(
        "check-all",
        help="Audit every collection",
        description="Run full quality analysis for all collections in Qdrant.",
    )

    p_dedup = sub.add_parser(
        "delete-duplicates",
        help="Delete duplicate points in one collection",
        description="Find duplicate points by (url, chunk_index) and delete extras.",
    )
    p_dedup.add_argument("--collection", default=DEFAULT_COLLECTION)

    p_ex = sub.add_parser(
        "delete-excluded",
        help="Delete points whose URL path matches exclude prefixes",
        description="Delete points that match effective exclude-path-prefix rules.",
    )
    p_ex.add_argument("--collection", default=DEFAULT_COLLECTION)

    sub.add_parser(
        "delete-duplicates-all",
        help="Delete duplicate points in all collections",
        description="Find and delete duplicate points across every collection.",
    )
    sub.add_parser(
        "delete-excluded-all",
        help="Delete excluded-path matches in all collections",
        description="Delete points matching exclude-path-prefix rules in every collection.",
    )

    return parser


def main() -> int:
    raw_args = sys.argv[1:]
    if not raw_args or raw_args[0] == "help" or "-h" in raw_args or "--help" in raw_args:
        print(render_help_text())
        return 0

    parser = build_parser()
    forced_json = "--json" in raw_args
    forced_dry_run = "--dry-run" in raw_args
    forced_sample: int | None = None
    sample_parse_error: str | None = None
    normalized_args: list[str] = []
    i = 0
    while i < len(raw_args):
        token = raw_args[i]
        if token in {"--json", "--dry-run"}:
            i += 1
            continue
        if token == "--sample":
            if i + 1 < len(raw_args):
                try:
                    forced_sample = int(raw_args[i + 1])
                except ValueError:
                    sample_parse_error = f"invalid int value for --sample: {raw_args[i + 1]!r}"
                i += 2
                continue
            sample_parse_error = "--sample requires a value"
            i += 1
            continue
        if token.startswith("--sample="):
            try:
                forced_sample = int(token.split("=", 1)[1])
            except ValueError:
                sample_parse_error = f"invalid int value for --sample: {token.split('=', 1)[1]!r}"
            i += 1
            continue
        normalized_args.append(token)
        i += 1

    args = parser.parse_args(normalized_args)
    if sample_parse_error:
        parser.error(sample_parse_error)
    json_mode = bool(args.json or forced_json)
    dry_run_mode = bool(args.dry_run or forced_dry_run)

    configured_url = str(args.url).rstrip("/")
    resolved_url = resolve_runtime_qdrant_url(configured_url)
    set_qdrant_url(resolved_url)

    emit_output = not json_mode
    if emit_output:
        print(f"\n{primary('Qdrant Quality Check')}")
        print(f"{accent('URL:')} {get_qdrant_url()}")
        if get_qdrant_url() != configured_url:
            print(
                f"{muted('Configured URL')} {configured_url} {muted('was not reachable from this runtime; using')} {get_qdrant_url()}"
            )

    raw_prefixes: list[str] = []
    env_prefixes = os.getenv("AXON_EXCLUDE_PATH_PREFIX") or DOTENV_VALUES.get("AXON_EXCLUDE_PATH_PREFIX") or os.getenv("EXCLUDE_PATH_PREFIX") or DOTENV_VALUES.get("EXCLUDE_PATH_PREFIX")
    if env_prefixes:
        raw_prefixes.extend(parse_csv_values(env_prefixes))
    for item in args.exclude_path_prefix:
        raw_prefixes.extend(parse_csv_values(item))

    normalized = normalize_exclude_prefixes(raw_prefixes)
    effective_exclude_prefixes = normalized.prefixes.copy()
    if not effective_exclude_prefixes and not normalized.disable_defaults:
        effective_exclude_prefixes = list(DEFAULT_EXCLUDE_PREFIXES)

    if emit_output:
        print(f"{accent('Exclude path prefixes loaded:')} {len(effective_exclude_prefixes)}")

    command = args.command
    resolved_sample = forced_sample if forced_sample is not None else args.sample
    sample_limit = resolved_sample if resolved_sample and resolved_sample > 0 else None
    destructive_commands = {
        "delete-duplicates",
        "delete-excluded",
        "delete-duplicates-all",
        "delete-excluded-all",
    }
    if sample_limit is not None and command in destructive_commands and not dry_run_mode:
        parser.error("--sample is only allowed with destructive commands when --dry-run is set")

    if command == "health":
        result = display_health_info(emit_output=emit_output)
        if json_mode:
            print(json.dumps({"command": "health", **result}, indent=2))
        return 0

    if command == "aliases":
        result = display_aliases_info(emit_output=emit_output)
        if json_mode:
            print(json.dumps({"command": "aliases", **result}, indent=2))
        return 0

    if command == "strict-exclude-sync":
        result = analyze_exclude_sync(effective_exclude_prefixes)
        if emit_output:
            print(f"\n{primary('Strict Exclude Sync')}")
            print(muted("=" * 60))
            sync_status = status_text("completed" if result["in_sync"] else "failed")
            print(f"  {accent('Status:')} {sync_status}")
            print(f"  {accent('Rust defaults:')} {result['rust_defaults_count']}")
            print(f"  {accent('Script defaults:')} {result['script_defaults_count']}")
            print(f"  {accent('Effective excludes:')} {result['effective_excludes_count']}")
            if result["missing_in_script"]:
                print(f"  {accent('Missing in script:')} {', '.join(result['missing_in_script'])}")
            if result["extra_in_script"]:
                print(f"  {accent('Extra in script:')} {', '.join(result['extra_in_script'])}")
        if json_mode:
            print(json.dumps({"command": "strict-exclude-sync", **result}, indent=2))
        return 0

    if command == "payload-schema":
        points = fetch_all_points(args.collection, emit_output=emit_output, sample_limit=sample_limit)
        result = analyze_payload_schema(points)
        if emit_output:
            print(f"\n{primary('Payload Schema Audit')} {accent(args.collection)}")
            print(muted("=" * 60))
            print(f"  {accent('Points scanned:')} {result['total_points']}")
            for field, stat in result["fields"].items():
                print(
                    f"  {accent(field + ':')} present={stat['present']} missing={stat['missing']} type_mismatch={stat['type_mismatch']}"
                )
        if json_mode:
            print(json.dumps({"command": "payload-schema", "collection": args.collection, "sample_limit": sample_limit, "result": result}, indent=2))
        return 0

    if command == "domain-breakdown":
        points = fetch_all_points(args.collection, emit_output=emit_output, sample_limit=sample_limit)
        result = analyze_domain_breakdown(points, top=max(1, int(args.top)))
        if emit_output:
            print(f"\n{primary('Domain Breakdown')} {accent(args.collection)}")
            print(muted("=" * 60))
            print(f"  {accent('Domains:')} {result['total_domains']}")
            for row in result["top_domains"]:
                print(
                    f"  {accent(row['domain'])} {muted('points=')}{row['points']} {muted('urls=')}{row['unique_urls']} {muted('dup_rate=')}{row['duplicate_rate_pct']}%"
                )
        if json_mode:
            print(json.dumps({"command": "domain-breakdown", "collection": args.collection, "sample_limit": sample_limit, "top": args.top, "result": result}, indent=2))
        return 0

    if command == "stale-data":
        points = fetch_all_points(args.collection, emit_output=emit_output, sample_limit=sample_limit)
        result = analyze_stale_data(points, days=max(1, int(args.days)))
        if emit_output:
            print(f"\n{primary('Stale Data Audit')} {accent(args.collection)}")
            print(muted("=" * 60))
            print(f"  {accent('Threshold days:')} {result['threshold_days']}")
            print(f"  {accent('Points total:')} {result['points_total']}")
            print(f"  {accent('With timestamp:')} {result['points_with_timestamp']}")
            print(f"  {accent('Missing timestamp:')} {result['points_missing_timestamp']}")
            print(f"  {accent('Stale points:')} {result['stale_points']} ({result['stale_rate_pct']}%)")
            print(f"  {accent('Newest:')} {result['newest_timestamp']}")
            print(f"  {accent('Oldest:')} {result['oldest_timestamp']}")
        if json_mode:
            print(json.dumps({"command": "stale-data", "collection": args.collection, "sample_limit": sample_limit, "days": args.days, "result": result}, indent=2))
        return 0

    if command == "check":
        result = check_collection(
            args.collection,
            dry_run=dry_run_mode,
            exclude_prefixes=effective_exclude_prefixes,
            sample_limit=sample_limit,
            emit_output=emit_output,
        )
        if json_mode:
            print(json.dumps({"command": "check", "dry_run": dry_run_mode, "result": result}, indent=2))
        return 0

    if command == "check-all":
        health = display_health_info(emit_output=emit_output)
        collections = list_collections()
        if not collections:
            if emit_output:
                print("\nNo collections found")
            if json_mode:
                print(json.dumps({"command": "check-all", "dry_run": dry_run_mode, "health": health, "results": []}, indent=2))
            return 0
        all_results: list[dict[str, Any]] = []
        for name in collections:
            all_results.append(
                check_collection(
                    name,
                    dry_run=dry_run_mode,
                    exclude_prefixes=effective_exclude_prefixes,
                    sample_limit=sample_limit,
                    emit_output=emit_output,
                )
            )
        if json_mode:
            print(json.dumps({"command": "check-all", "dry_run": dry_run_mode, "health": health, "results": all_results}, indent=2))
        return 0

    if command == "delete-duplicates":
        confirm_destructive_action(
            command,
            yes=args.yes,
            dry_run=dry_run_mode,
            target=f"collection '{args.collection}'",
        )
        result = check_collection(
            args.collection,
            delete_duplicates=True,
            dry_run=dry_run_mode,
            exclude_prefixes=effective_exclude_prefixes,
            sample_limit=sample_limit,
            emit_output=emit_output,
        )
        if json_mode:
            print(json.dumps({"command": "delete-duplicates", "dry_run": dry_run_mode, "result": result}, indent=2))
        return 0

    if command == "delete-excluded":
        confirm_destructive_action(
            command,
            yes=args.yes,
            dry_run=dry_run_mode,
            target=f"collection '{args.collection}'",
        )
        result = check_collection(
            args.collection,
            delete_excluded=True,
            dry_run=dry_run_mode,
            exclude_prefixes=effective_exclude_prefixes,
            sample_limit=sample_limit,
            emit_output=emit_output,
        )
        if json_mode:
            print(json.dumps({"command": "delete-excluded", "dry_run": dry_run_mode, "result": result}, indent=2))
        return 0

    if command == "delete-duplicates-all":
        confirm_destructive_action(
            command,
            yes=args.yes,
            dry_run=dry_run_mode,
            target="all collections",
        )
        collections = list_collections()
        all_results: list[dict[str, Any]] = []
        for name in collections:
            all_results.append(
                check_collection(
                    name,
                    delete_duplicates=True,
                    dry_run=dry_run_mode,
                    exclude_prefixes=effective_exclude_prefixes,
                    sample_limit=sample_limit,
                    emit_output=emit_output,
                )
            )
        if json_mode:
            print(json.dumps({"command": "delete-duplicates-all", "dry_run": dry_run_mode, "results": all_results}, indent=2))
        return 0

    if command == "delete-excluded-all":
        confirm_destructive_action(
            command,
            yes=args.yes,
            dry_run=dry_run_mode,
            target="all collections",
        )
        collections = list_collections()
        all_results: list[dict[str, Any]] = []
        for name in collections:
            all_results.append(
                check_collection(
                    name,
                    delete_excluded=True,
                    dry_run=dry_run_mode,
                    exclude_prefixes=effective_exclude_prefixes,
                    sample_limit=sample_limit,
                    emit_output=emit_output,
                )
            )
        if json_mode:
            print(json.dumps({"command": "delete-excluded-all", "dry_run": dry_run_mode, "results": all_results}, indent=2))
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
