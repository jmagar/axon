#!/usr/bin/env python3
"""Analysis and reporting helpers for qdrant quality checks."""

from __future__ import annotations

import urllib.parse
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from qdrant_quality_models import (
    DataQualityIssues,
    DuplicateGroup,
    ExcludeViolationStats,
)
from qdrant_quality_runtime import extract_rust_default_excludes
from qdrant_quality_settings import DEFAULT_EXCLUDE_PREFIXES


def canonicalize_url_for_dedupe(url: str) -> str:
    """Normalize URL for duplicate grouping, matching Rust crawler behavior."""
    parsed = urllib.parse.urlparse(url)

    fragmentless = parsed._replace(fragment="")

    netloc = fragmentless.netloc
    hostname = fragmentless.hostname or ""
    port = fragmentless.port
    if (fragmentless.scheme == "http" and port == 80) or (
        fragmentless.scheme == "https" and port == 443
    ):
        userinfo = ""
        if "@" in netloc:
            userinfo = netloc.split("@", 1)[0] + "@"
        netloc = f"{userinfo}{hostname}"

    path = fragmentless.path or "/"
    if len(path) > 1:
        path = path.rstrip("/")
        if not path:
            path = "/"

    normalized = fragmentless._replace(netloc=netloc, path=path)
    return urllib.parse.urlunparse(normalized)


def check_data_quality(points: list[dict[str, Any]]) -> DataQualityIssues:
    issues = DataQualityIssues()
    for point in points:
        payload = point.get("payload") or {}
        url = payload.get("url")
        chunk_text = payload.get("chunk_text")
        chunk_index = payload.get("chunk_index")

        if not url:
            issues.missing_url += 1

        if chunk_text is None:
            issues.missing_content += 1
        elif isinstance(chunk_text, str) and chunk_text.strip() == "":
            issues.empty_content += 1

        if chunk_index is None:
            issues.missing_chunk_index += 1
    return issues


def find_duplicates(points: list[dict[str, Any]]) -> list[DuplicateGroup]:
    grouped: dict[str, list[Any]] = defaultdict(list)

    for point in points:
        payload = point.get("payload") or {}
        url = payload.get("url")
        chunk_index = payload.get("chunk_index")
        point_id = point.get("id")
        if not url:
            continue
        canonical_url = canonicalize_url_for_dedupe(url)
        key = f"{canonical_url}:::{chunk_index if chunk_index is not None else 'none'}"
        grouped[key].append(point_id)

    out: list[DuplicateGroup] = []
    for key, ids in grouped.items():
        if len(ids) > 1:
            url = key.split(":::", 1)[0]
            out.append(DuplicateGroup(url=url, count=len(ids), ids=ids))

    out.sort(key=lambda x: x.count, reverse=True)
    return out


def path_prefix_excluded(path: str, prefix: str) -> bool:
    normalized = prefix if prefix.startswith("/") else f"/{prefix}"
    boundary_prefix = normalized.rstrip("/")
    if not boundary_prefix:
        return False
    if path == boundary_prefix:
        return True
    if path.startswith(boundary_prefix):
        rest = path[len(boundary_prefix) :]
        return rest.startswith("/")
    return False


def is_excluded_url_path(url: str, prefixes: list[str]) -> tuple[bool, str | None]:
    if not prefixes:
        return (False, None)

    try:
        path = urllib.parse.urlparse(url).path or "/"
    except Exception:
        path = "/"

    for prefix in prefixes:
        if path_prefix_excluded(path, prefix):
            return (True, prefix)

    return (False, None)


def check_exclude_violations(
    points: list[dict[str, Any]], prefixes: list[str]
) -> ExcludeViolationStats:
    if not prefixes:
        return ExcludeViolationStats(0, 0, [], [])

    matched_by_url: dict[str, tuple[int, str]] = {}
    matched_ids: list[Any] = []
    matched_points = 0

    for point in points:
        payload = point.get("payload") or {}
        url = payload.get("url")
        if not isinstance(url, str) or not url:
            continue

        matched, matched_prefix = is_excluded_url_path(url, prefixes)
        if not matched or not matched_prefix:
            continue

        matched_points += 1
        matched_ids.append(point.get("id"))

        prev = matched_by_url.get(url)
        if prev is None:
            matched_by_url[url] = (1, matched_prefix)
        else:
            matched_by_url[url] = (prev[0] + 1, prev[1])

    top_urls = sorted(
        [(u, c, p) for u, (c, p) in matched_by_url.items()],
        key=lambda row: row[1],
        reverse=True,
    )[:10]

    return ExcludeViolationStats(
        matched_points=matched_points,
        matched_urls=len(matched_by_url),
        matched_ids=matched_ids,
        top_urls=top_urls,
    )


def summarize_chunk_distribution(
    points: list[dict[str, Any]],
) -> tuple[dict[str, int], list[int]]:
    url_counts: dict[str, int] = defaultdict(int)
    for point in points:
        payload = point.get("payload") or {}
        url = payload.get("url")
        if isinstance(url, str) and url:
            url_counts[url] += 1
    counts = sorted(url_counts.values())
    return dict(url_counts), counts


def analyze_payload_schema(points: list[dict[str, Any]]) -> dict[str, Any]:
    checks: dict[str, dict[str, int]] = {
        "url": {"present": 0, "missing": 0, "type_mismatch": 0},
        "chunk_text": {"present": 0, "missing": 0, "type_mismatch": 0},
        "chunk_index": {"present": 0, "missing": 0, "type_mismatch": 0},
        "title": {"present": 0, "missing": 0, "type_mismatch": 0},
        "scraped_at": {"present": 0, "missing": 0, "type_mismatch": 0},
    }

    def inspect(
        checks: dict[str, dict[str, int]],
        payload: dict[str, Any],
        field: str,
        value: Any,
        expected: tuple[type, ...],
        aliases: list[str] | None = None,
    ) -> None:
        vals: list[Any] = [value]
        if aliases:
            vals.extend(payload.get(a) for a in aliases)
        actual = next((v for v in vals if v is not None), None)
        if actual is None:
            checks[field]["missing"] += 1
            return
        if isinstance(actual, expected):
            checks[field]["present"] += 1
            return
        checks[field]["type_mismatch"] += 1

    for point in points:
        payload = point.get("payload") or {}

        inspect(checks, payload, "url", payload.get("url"), (str,))
        inspect(checks, payload, "chunk_text", payload.get("chunk_text"), (str,))
        inspect(checks, payload, "chunk_index", payload.get("chunk_index"), (int,))
        inspect(checks, payload, "title", payload.get("title"), (str,))
        inspect(
            checks,
            payload,
            "scraped_at",
            payload.get("scraped_at"),
            (str,),
            aliases=["scrapedAt", "file_modified_at", "fileModifiedAt"],
        )

    return {
        "total_points": len(points),
        "fields": checks,
    }


def analyze_domain_breakdown(
    points: list[dict[str, Any]], top: int = 20
) -> dict[str, Any]:
    domain_points: dict[str, int] = defaultdict(int)
    by_domain_for_duplicates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unique_urls_per_domain: dict[str, set[str]] = defaultdict(set)

    for point in points:
        payload = point.get("payload") or {}
        url = payload.get("url")
        if not isinstance(url, str) or not url:
            continue
        parsed = urllib.parse.urlparse(url)
        domain = (parsed.hostname or "").lower() or "(invalid-url)"
        domain_points[domain] += 1
        by_domain_for_duplicates[domain].append(point)
        unique_urls_per_domain[domain].add(url)

    rows: list[dict[str, Any]] = []
    for domain, count in domain_points.items():
        duplicates = find_duplicates(by_domain_for_duplicates[domain])
        duplicate_points = sum(max(0, d.count - 1) for d in duplicates)
        dup_rate = (duplicate_points / count * 100.0) if count > 0 else 0.0
        rows.append(
            {
                "domain": domain,
                "points": count,
                "unique_urls": len(unique_urls_per_domain[domain]),
                "duplicate_groups": len(duplicates),
                "duplicate_points": duplicate_points,
                "duplicate_rate_pct": round(dup_rate, 2),
            }
        )

    rows.sort(key=lambda r: r["points"], reverse=True)
    return {
        "total_domains": len(rows),
        "top_domains": rows[:top],
    }


def parse_payload_timestamp(payload: dict[str, Any]) -> datetime | None:
    candidates = [
        payload.get("scraped_at"),
        payload.get("scrapedAt"),
        payload.get("file_modified_at"),
        payload.get("fileModifiedAt"),
    ]
    for value in candidates:
        if not isinstance(value, str) or not value.strip():
            continue
        v = value.strip()
        if v.endswith("Z"):
            v = v[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(v)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt.astimezone(UTC)
        except ValueError:
            continue
    return None


def analyze_stale_data(points: list[dict[str, Any]], days: int) -> dict[str, Any]:
    now = datetime.now(UTC)
    threshold = now - timedelta(days=days)
    with_timestamp = 0
    stale = 0
    newest: datetime | None = None
    oldest: datetime | None = None

    for point in points:
        payload = point.get("payload") or {}
        ts = parse_payload_timestamp(payload)
        if ts is None:
            continue
        with_timestamp += 1
        if ts < threshold:
            stale += 1
        if newest is None or ts > newest:
            newest = ts
        if oldest is None or ts < oldest:
            oldest = ts

    return {
        "threshold_days": days,
        "threshold_utc": threshold.isoformat(),
        "points_total": len(points),
        "points_with_timestamp": with_timestamp,
        "points_missing_timestamp": len(points) - with_timestamp,
        "stale_points": stale,
        "stale_rate_pct": round((stale / with_timestamp * 100.0), 2)
        if with_timestamp
        else 0.0,
        "newest_timestamp": newest.isoformat() if newest else None,
        "oldest_timestamp": oldest.isoformat() if oldest else None,
    }


def analyze_exclude_sync(effective_excludes: list[str]) -> dict[str, Any]:
    rust_defaults = extract_rust_default_excludes()
    script_defaults = sorted(set(DEFAULT_EXCLUDE_PREFIXES))
    rust_set = set(rust_defaults)
    script_set = set(script_defaults)

    missing_in_script = sorted(rust_set - script_set)
    extra_in_script = sorted(script_set - rust_set)
    in_sync = not missing_in_script and not extra_in_script

    return {
        "in_sync": in_sync,
        "rust_defaults_count": len(rust_defaults),
        "script_defaults_count": len(script_defaults),
        "effective_excludes_count": len(effective_excludes),
        "missing_in_script": missing_in_script,
        "extra_in_script": extra_in_script,
        "rust_defaults": rust_defaults,
        "script_defaults": script_defaults,
        "effective_excludes": effective_excludes,
    }


# Re-export functions moved to qdrant_quality_reporting for backward compatibility.
# This import is intentionally at the bottom to avoid circular import issues:
# qdrant_quality_reporting imports from this module, so this module must be
# fully defined before importing from qdrant_quality_reporting.
from qdrant_quality_reporting import (  # noqa: E402, F401
    check_collection,
    collect_health_info,
    confirm_destructive_action,
    display_aliases_info,
    display_health_info,
)
