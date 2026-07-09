import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { GitHubBrowseResult } from "@/lib/actionRequest";
import { feedKindLabel, feedKindIcon, groupFeedByDay, type FeedItem, type FeedPayload } from "@/lib/githubFeed";
import { invoke } from "@/lib/invoke";
import { isRecord } from "@/lib/payload";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; payload: FeedPayload }
  | { kind: "error"; message: string };

/**
 * The Feed tab's content: fetches `github_browse({ kind: "feed", owner })` on
 * mount (a fresh authenticated-if-possible fan-out across the owner's most
 * recently updated repos — see `src-tauri/src/github_feed.rs` for the fan-out
 * and normalization), groups results by day, and renders one row per item.
 * Clicking a row calls `onOpenItem`, which the parent `GitHubView` uses to
 * jump into the split-pane tree/preview view (opening the item's repo, and
 * its `path` when the event's `path` heuristic found one) — see
 * `GitHubView.tsx`'s `onFeedItemOpen`.
 */
export function GitHubFeedView({
  owner,
  onOpenItem,
}: {
  owner: string;
  onOpenItem: (item: FeedItem) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    invoke<GitHubBrowseResult>("github_browse", { request: { kind: "feed", owner } })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ kind: "error", message: result.error ?? "Unable to load activity feed." });
          return;
        }
        const payload = isRecord(result.payload) ? (result.payload as unknown as FeedPayload) : { items: [], partial: false, errors: [] };
        setState({ kind: "loaded", payload });
      })
      .catch((err) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [owner]);

  if (state.kind === "loading") {
    return (
      <section className="operation-section github-feed-loading">
        <Loader2 size={16} className="github-spin" />
        <span>Loading activity...</span>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="operation-section">
        <div className="github-feed-error">
          <AlertTriangle size={14} />
          <span>{state.message}</span>
        </div>
      </section>
    );
  }

  const groups = groupFeedByDay(state.payload.items);
  if (groups.length === 0) {
    return (
      <div className="operation-empty">
        <strong>No activity</strong>
        <span>No recent pushes, PRs, reviews, issues, or releases were found across this owner&apos;s most recently updated repos.</span>
      </div>
    );
  }

  return (
    <section className="operation-section">
      {state.payload.partial ? (
        <p className="operation-muted github-feed-partial">
          Some repos could not be loaded ({state.payload.errors.length}) — showing partial results.
        </p>
      ) : null}
      <div className="github-feed">
        {groups.map((group) => (
          <div key={group.label} className="github-feed-day">
            <h3 className="stats-heading">{group.label}</h3>
            <div className="operation-list">
              {group.items.map((item) => (
                <FeedRow
                  key={`${item.repo}-${item.kind}-${item.timestampUnix}-${item.title}`}
                  item={item}
                  onOpen={() => onOpenItem(item)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Corrected against the real mock's `feedRow()` markup (verified in
 * `palette-mock.html`, search `feedRow`): a colored icon swatch in the kind's
 * tone, a header line of [owner/repo] + [kind label, in the kind's tone] +
 * [#num if present], the title, and a meta line of [actor initial chip +
 * actor name] + middot + [meta string] + [badge], with relative time shown
 * to the right of the row (this plan renders it via `formatRelativeTime`
 * below rather than a mock-fixture `time` string, since `FeedItem` carries a
 * raw `timestampUnix`, not a precomputed relative string). The first
 * drafting pass's `FeedRow` (icon + title + "repo · actor" line + a single
 * kind badge on the right) did not match this structure — now corrected.
 */
function FeedRow({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  const Icon = feedKindIcon(item.kind);
  return (
    <button type="button" className="operation-row github-feed-row" onClick={onOpen}>
      <span className="github-feed-icon">
        <Icon size={15} aria-hidden="true" />
      </span>
      <div className="operation-row-main">
        <div className="github-feed-row-head">
          <span className="github-feed-repo">{item.repo}</span>
          <span className="github-feed-kind">{feedKindLabel(item.kind)}</span>
          {item.num !== null ? <span className="github-feed-num">#{item.num}</span> : null}
        </div>
        <div className="operation-row-title">{item.title}</div>
        <div className="github-feed-row-meta">
          <span className="github-feed-actor">
            <span className="github-feed-actor-chip">{(item.actor[0] ?? "?").toUpperCase()}</span>
            {item.actor}
          </span>
          <span className="github-feed-dot">·</span>
          <span>{item.meta}</span>
          <FeedBadgeView badge={item.badge} />
        </div>
      </div>
      <span className="github-feed-time">{formatRelativeTime(item.timestampUnix)}</span>
    </button>
  );
}

/** Mirrors the mock's `feedBadge()`: a `{add, del}` line-diff pair, or a
 * short status-label pill. Renders nothing when `badge` is `null` — the
 * common case for kinds this plan can't reliably badge yet, see Task 3. */
function FeedBadgeView({ badge }: { badge: FeedItem["badge"] }) {
  if (!badge) return null;
  if (badge.type === "diff") {
    return (
      <span className="github-feed-diff">
        <span className="github-feed-diff-add">+{badge.add}</span>
        <span className="github-feed-diff-del">-{badge.del}</span>
      </span>
    );
  }
  return <span className="github-feed-badge">{badge.value}</span>;
}

/** Coarse relative-time formatter for the feed row's right-aligned time
 * column (mock examples: "11m", "34m", "3h", "Yesterday", "2d"). */
function formatRelativeTime(timestampUnix: number): string {
  const deltaSec = Math.max(0, Math.floor(Date.now() / 1000) - timestampUnix);
  if (deltaSec < 3600) return `${Math.max(1, Math.floor(deltaSec / 60))}m`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h`;
  return `${Math.floor(deltaSec / 86400)}d`;
}
