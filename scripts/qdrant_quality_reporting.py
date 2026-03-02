#!/usr/bin/env python3
"""Display and reporting functions for qdrant quality checks."""

from __future__ import annotations

import sys
from typing import Any

from qdrant_quality_client import (
    delete_points,
    fetch_all_points,
    get_cluster_info,
    get_collection_info,
    list_aliases,
    list_collections,
)
from qdrant_quality_settings import DEFAULT_EXCLUDE_PREFIXES
from qdrant_quality_ui import accent, muted, primary, status_text

from qdrant_quality_analysis import (
    check_data_quality,
    check_exclude_violations,
    find_duplicates,
    summarize_chunk_distribution,
)


def collect_health_info() -> dict[str, Any]:
    info = get_cluster_info()
    collections = list_collections()
    collection_rows: list[dict[str, Any]] = []
    total_points = 0
    total_vectors = 0

    for name in collections:
        c = get_collection_info(name)
        points_count = int(c.get("points_count") or 0)
        vectors_count = int(c.get("vectors_count") or 0)
        indexed_vectors_count = int(c.get("indexed_vectors_count") or 0)
        segments_count = int(c.get("segments_count") or 0)
        status = str(c.get("status", "unknown"))

        total_points += points_count
        total_vectors += vectors_count
        collection_rows.append(
            {
                "name": name,
                "points_count": points_count,
                "vectors_count": vectors_count,
                "indexed_vectors_count": indexed_vectors_count,
                "segments_count": segments_count,
                "status": status,
            }
        )

    return {
        "cluster": {
            "version": info.get("version", "unknown"),
            "commit": info.get("commit"),
        },
        "collections_count": len(collection_rows),
        "collections": collection_rows,
        "totals": {"points": total_points, "vectors": total_vectors},
    }


def display_health_info(*, emit_output: bool = True) -> dict[str, Any]:
    result = collect_health_info()
    if not emit_output:
        return result

    print(f"\n{primary('Qdrant Health & Statistics')}")
    print(muted("=" * 60))
    print(f"\n{primary('Cluster Info')}:")
    print(f"  {accent('Version:')} {result['cluster']['version']}")
    if result["cluster"].get("commit"):
        print(f"  {accent('Commit:')} {str(result['cluster']['commit'])[:8]}")

    print(f"\n{primary('Collections:')} {result['collections_count']} total")
    if result["collections_count"] == 0:
        print("  (No collections found)")
        return result

    for row in result["collections"]:
        print(f"\n  - {accent(row['name'])}")
        print(f"    {accent('Points:')} {row['points_count']:,}")
        print(f"    {accent('Vectors:')} {row['vectors_count']:,}")
        print(f"    {accent('Indexed:')} {row['indexed_vectors_count']:,}")
        print(f"    {accent('Segments:')} {row['segments_count']}")
        print(f"    {accent('Status:')} {status_text(row['status'])}")

    print(f"\n{primary('Overall Stats')}:")
    print(f"  {accent('Total points:')} {result['totals']['points']:,}")
    print(f"  {accent('Total vectors:')} {result['totals']['vectors']:,}")
    return result


def display_aliases_info(*, emit_output: bool = True) -> dict[str, Any]:
    aliases = list_aliases()
    collections = set(list_collections())
    dangling = [a for a in aliases if a["collection_name"] not in collections]
    result = {
        "aliases_count": len(aliases),
        "dangling_count": len(dangling),
        "aliases": aliases,
        "dangling": dangling,
    }

    if not emit_output:
        return result

    print(f"\n{primary('Qdrant Aliases')}")
    print(muted("=" * 60))
    print(f"  {accent('Aliases:')} {len(aliases)}")
    print(f"  {accent('Dangling:')} {len(dangling)}")
    if not aliases:
        print(f"  {muted('No aliases found.')}")
        return result

    for row in aliases:
        marker = status_text("failed") if row in dangling else status_text("completed")
        print(
            f"  {marker} {accent(row['alias_name'])} {muted('->')} {row['collection_name']}"
        )

    return result


def confirm_destructive_action(
    command: str, *, yes: bool, dry_run: bool, target: str
) -> None:
    if dry_run:
        return
    if yes:
        return
    if not sys.stdin.isatty():
        raise RuntimeError(
            f"Destructive command '{command}' on {target} requires --yes in non-interactive mode"
        )
    prompt = f"{command} will mutate {target}. Proceed? [y/N]: "
    print(prompt, end="", flush=True, file=sys.stderr)
    answer = input().strip().lower()
    if answer not in {"y", "yes"}:
        raise RuntimeError("Aborted by user")


def check_collection(
    collection: str,
    *,
    delete_duplicates: bool = False,
    delete_excluded: bool = False,
    dry_run: bool = False,
    exclude_prefixes: list[str] | None = None,
    sample_limit: int | None = None,
    emit_output: bool = True,
) -> dict[str, Any]:
    if emit_output:
        print(f"\n{primary('Collection:')} {accent(collection)}")
        print(muted("=" * 60))

    points = fetch_all_points(
        collection, emit_output=emit_output, sample_limit=sample_limit
    )
    if not points:
        if emit_output:
            print("No points found in collection")
        return {
            "collection": collection,
            "total_points": 0,
            "unique_urls": 0,
            "data_quality": {
                "missing_url": 0,
                "missing_content": 0,
                "empty_content": 0,
                "missing_chunk_index": 0,
                "total_issues": 0,
            },
            "exclude": {
                "matched_points": 0,
                "matched_urls": 0,
                "top_urls": [],
                "deleted_points": 0,
                "would_delete_points": 0,
            },
            "duplicates": {
                "groups": 0,
                "total_duplicate_points": 0,
                "top_urls": [],
                "deleted_points": 0,
                "would_delete_points": 0,
            },
            "chunk_distribution": None,
        }

    prefixes = (
        exclude_prefixes if exclude_prefixes is not None else DEFAULT_EXCLUDE_PREFIXES
    )

    if emit_output:
        print(f"\n{primary('Data Quality Check')}")
    issues = check_data_quality(points)
    if emit_output:
        if issues.total == 0:
            print("  OK: no data quality issues")
        else:
            print(f"  Issues found: {issues.total}")
            if issues.missing_url:
                print(f"  - Missing URL: {issues.missing_url}")
            if issues.missing_content:
                print(f"  - Missing content: {issues.missing_content}")
            if issues.empty_content:
                print(f"  - Empty content: {issues.empty_content}")
            if issues.missing_chunk_index:
                print(f"  - Missing chunk_index: {issues.missing_chunk_index}")

    if emit_output:
        print(f"\n{primary('Exclude Rules Check')}")
    excluded = check_exclude_violations(points, prefixes)
    excluded_unique_ids = [
        x for x in dict.fromkeys(excluded.matched_ids) if x is not None
    ]
    excluded_deleted = 0
    if emit_output:
        if excluded.matched_points == 0:
            print("  OK: no points matched exclude rules")
        else:
            print(
                f"  Matched: {excluded.matched_points} points across {excluded.matched_urls} URLs"
            )
            for url, count, pattern in excluded.top_urls:
                print(f"  - {count}x {url}")
                print(f"    pattern: {pattern}")

    if delete_excluded and excluded_unique_ids:
        if dry_run:
            if emit_output:
                print(
                    f"  {muted('dry-run: would delete')} {len(excluded_unique_ids)} {muted('exclude-matched points')}"
                )
        else:
            delete_points(collection, excluded_unique_ids, emit_output=emit_output)
            excluded_deleted = len(excluded_unique_ids)

    if emit_output:
        print(f"\n{primary('Duplicate Chunk Analysis')}")
    duplicates = find_duplicates(points)
    duplicate_ids_to_delete: list[Any] = []
    for dup in duplicates:
        duplicate_ids_to_delete.extend(dup.ids[1:])
    total_duplicate_points = len(duplicate_ids_to_delete)
    duplicate_deleted = 0

    if emit_output:
        if not duplicates:
            print("  OK: no duplicate chunks")
        else:
            print(f"  Duplicate groups: {len(duplicates)}")
            for dup in duplicates[:10]:
                print(f"  - {dup.count}x {dup.url}")
            if len(duplicates) > 10:
                print(f"  ... and {len(duplicates) - 10} more")
            print(f"  Total duplicate points: {total_duplicate_points}")

    if delete_duplicates and duplicate_ids_to_delete:
        if dry_run:
            if emit_output:
                print(
                    f"  {muted('dry-run: would delete')} {len(duplicate_ids_to_delete)} {muted('duplicate points')}"
                )
        else:
            delete_points(collection, duplicate_ids_to_delete, emit_output=emit_output)
            duplicate_deleted = len(duplicate_ids_to_delete)

    url_counts, counts = summarize_chunk_distribution(points)
    chunk_distribution: dict[str, Any] | None = None
    if counts:
        chunk_distribution = {
            "min": counts[0],
            "median": counts[len(counts) // 2],
            "avg": len(points) / len(url_counts),
            "max": counts[-1],
            "urls_over_50": len([c for c in counts if c > 50]),
        }
    if emit_output:
        print(f"\n{primary('Chunk Distribution')}")
        if chunk_distribution:
            print(f"  Min chunks per URL: {chunk_distribution['min']}")
            print(f"  Median chunks per URL: {chunk_distribution['median']}")
            print(f"  Average chunks per URL: {chunk_distribution['avg']:.1f}")
            print(f"  Max chunks per URL: {chunk_distribution['max']}")

    result = {
        "collection": collection,
        "total_points": len(points),
        "unique_urls": len(url_counts),
        "data_quality": {
            "missing_url": issues.missing_url,
            "missing_content": issues.missing_content,
            "empty_content": issues.empty_content,
            "missing_chunk_index": issues.missing_chunk_index,
            "total_issues": issues.total,
        },
        "exclude": {
            "matched_points": excluded.matched_points,
            "matched_urls": excluded.matched_urls,
            "top_urls": [
                {"url": u, "points": c, "prefix": p} for u, c, p in excluded.top_urls
            ],
            "would_delete_points": len(excluded_unique_ids),
            "deleted_points": excluded_deleted,
        },
        "duplicates": {
            "groups": len(duplicates),
            "total_duplicate_points": total_duplicate_points,
            "top_urls": [{"url": d.url, "count": d.count} for d in duplicates[:10]],
            "would_delete_points": len(duplicate_ids_to_delete),
            "deleted_points": duplicate_deleted,
        },
        "chunk_distribution": chunk_distribution,
    }

    if emit_output:
        print(f"\n{primary('Summary')}")
        print(f"  {accent('Total points:')} {result['total_points']}")
        print(f"  {accent('Unique URLs:')} {result['unique_urls']}")
        print(f"  {accent('Duplicate groups:')} {result['duplicates']['groups']}")
        print(
            f"  {accent('Data quality issues:')} {result['data_quality']['total_issues']}"
        )
        print(
            f"  {accent('Exclude rule matches:')} {result['exclude']['matched_points']} points ({result['exclude']['matched_urls']} URLs)"
        )

    return result
