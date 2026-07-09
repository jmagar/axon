// Single invoke wrapper used by every caller (App, axonClient).
//
// In the Tauri runtime it forwards to the real `@tauri-apps/api/core` invoke.
// In a plain browser (vite dev — used for design iteration/screenshots) it falls
// back to real same-origin HTTP for `axon_http_request`, which the vite proxy
// forwards to a live `axon serve`. This keeps a single code path so things like
// `executeAction` work identically in dev and production.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const isTauriRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Dev-fallback-only cap — much smaller than the Rust bridge's MAX_FEED_REPOS
 * (10), because this path is always unauthenticated (60 req/hr total) and
 * shared with every other GitHub call the browser-dev session makes. */
const DEV_FEED_MAX_REPOS = 3;

// Shared Tauri window handle with a browser fallback. In the Tauri runtime it is
// the real window (event listeners wired); under `vite dev` it is a no-op stub so
// `appWindow.listen(...)` is always callable. Consumed by App's window-event
// effect and the ask-stream effect in useActionRunner.
export const appWindow = isTauriRuntime
  ? getCurrentWindow()
  : {
      listen: async () => () => undefined,
    };

export async function invoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauriRuntime) return tauriInvoke<T>(command, args);
  switch (command) {
    case "axon_http_request": {
      const req = (args?.request ?? {}) as { method?: string; path?: string; body?: unknown };
      const method = (req.method ?? "GET").toUpperCase();
      const init: RequestInit = { method, headers: { accept: "application/json" } };
      if (req.body != null && method !== "GET" && method !== "DELETE") {
        init.headers = { ...(init.headers as Record<string, string>), "content-type": "application/json" };
        init.body = JSON.stringify(req.body);
      }
      const resp = await fetch(req.path ?? "/", init);
      const text = await resp.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      return { ok: resp.ok, status: resp.status, path: req.path ?? "", method, payload } as T;
    }
    case "github_browse": {
      // Dev-only fallback: `api.github.com` sends permissive CORS headers, so a
      // plain browser `fetch` works for design iteration under `pnpm vite:dev`
      // without needing the Tauri shell. Production always goes through the
      // real `github_browse` Rust command (src-tauri/src/github_bridge.rs),
      // which is the only path that can attach a `GITHUB_TOKEN` bearer
      // credential — this fallback is always unauthenticated (60 req/hr).
      return githubBrowseDevFallback(
        (args?.request ?? {}) as {
          kind?: string;
          owner?: string;
          repo?: string;
          branch?: string;
          path?: string;
        },
      ) as Promise<T>;
    }
    case "load_palette_config":
    case "load_palette_default_config":
      return {
        serverUrl: "http://127.0.0.1:8001",
        token: null,
        shortcut: "Ctrl+Shift+Space",
        collection: "axon",
        resultLimit: 10,
        theme: "dark",
        hideOnBlur: false,
        openResultsInline: true,
        agentBubbles: false,
        showFooterHints: false,
        envValues: {},
        configValues: {},
      } as T;
    case "save_palette_settings":
      return (args?.settings ?? args) as T;
    case "hide_palette":
    case "show_palette":
    case "resize_palette":
    case "set_blur_dismiss":
      return undefined as T;
    case "axon_oauth_status":
    case "axon_oauth_logout":
      return { signedIn: false, scope: null, expiresAtUnix: null, serverUrl: null } as T;
    case "axon_oauth_login":
      throw new Error("OAuth login is only available in the desktop app");
    default:
      throw new Error(`${command} is only available in the Tauri runtime`);
  }
}

interface GitHubBrowseDevRequest {
  kind?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  path?: string;
}

interface GitHubBrowseDevResult {
  ok: boolean;
  status: number;
  kind: string;
  owner: string;
  repo: string | null;
  branch: string | null;
  path: string | null;
  payload: unknown;
  error: string | null;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
  authenticated: boolean;
}

/** Browser-dev-only mirror of `github_bridge.rs::github_browse` — same URL
 * shapes, always unauthenticated, no `GITHUB_TOKEN` (the browser can't read
 * `~/.axon/.env`). Kept intentionally small; production correctness lives in
 * the Rust command and its own test suite. */
async function githubBrowseDevFallback(request: GitHubBrowseDevRequest): Promise<GitHubBrowseDevResult> {
  const owner = request.owner ?? "";
  const repo = request.repo;
  const branch = request.branch;
  const path = request.path;
  const kind = request.kind ?? "repos";
  let url: string;
  if (kind === "repos") {
    url = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?sort=updated&per_page=50`;
  } else if (kind === "feed") {
    return githubFeedDevFallback(owner);
  } else if (kind === "tree") {
    url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo ?? "")}/git/trees/${encodeURIComponent(branch || "main")}?recursive=1`;
  } else if (kind === "file") {
    const encodedPath = (path ?? "")
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo ?? "")}/contents/${encodedPath}`;
    if (branch) url += `?ref=${encodeURIComponent(branch)}`;
  } else {
    return {
      ok: false,
      status: 0,
      kind,
      owner,
      repo: repo ?? null,
      branch: branch ?? null,
      path: path ?? null,
      payload: null,
      error: `unknown GitHub browse kind: ${kind}`,
      rateLimitRemaining: null,
      rateLimitReset: null,
      authenticated: false,
    };
  }

  const resp = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const rateLimitRemaining = numericHeader(resp, "x-ratelimit-remaining");
  const rateLimitReset = numericHeader(resp, "x-ratelimit-reset");
  const text = await resp.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (resp.ok) {
    return {
      ok: true,
      status: resp.status,
      kind,
      owner,
      repo: repo ?? null,
      branch: branch ?? null,
      path: path ?? null,
      payload,
      error: null,
      rateLimitRemaining,
      rateLimitReset,
      authenticated: false,
    };
  }

  const message =
    payload && typeof payload === "object" && "message" in payload
      ? String((payload as { message: unknown }).message)
      : `GitHub API error: ${resp.status}`;
  return {
    ok: false,
    status: resp.status,
    kind,
    owner,
    repo: repo ?? null,
    branch: branch ?? null,
    path: path ?? null,
    payload: null,
    error: rateLimitRemaining === 0 ? "GitHub API rate limited — retry later" : message,
    rateLimitRemaining,
    rateLimitReset,
    authenticated: false,
  };
}

function numericHeader(resp: Response, name: string): number | null {
  const value = resp.headers.get(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Dev-only Feed fallback: fetches the owner's repo list, then fans out
 * `GET /repos/{owner}/{repo}/events` across the first `DEV_FEED_MAX_REPOS`
 * repos directly from the browser. Always unauthenticated — mirrors
 * `github_feed.rs::fetch_feed`'s normalization but is deliberately not a
 * byte-for-byte port (dev-only, small-N, no rate-limit retry/backoff). */
async function githubFeedDevFallback(owner: string): Promise<GitHubBrowseDevResult> {
  const reposResp = await fetch(
    `https://api.github.com/users/${encodeURIComponent(owner)}/repos?sort=updated&per_page=50`,
    { headers: { accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } },
  );
  if (!reposResp.ok) {
    return {
      ok: false,
      status: reposResp.status,
      kind: "feed",
      owner,
      repo: null,
      branch: null,
      path: null,
      payload: null,
      error: `GitHub API error: ${reposResp.status}`,
      rateLimitRemaining: numericHeader(reposResp, "x-ratelimit-remaining"),
      rateLimitReset: numericHeader(reposResp, "x-ratelimit-reset"),
      authenticated: false,
    };
  }
  const repos: Array<{ name: string }> = await reposResp.json();
  const capped = repos.slice(0, DEV_FEED_MAX_REPOS);

  const events = await Promise.all(
    capped.map(async (repo) => {
      const resp = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo.name)}/events?per_page=30`,
        { headers: { accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } },
      );
      if (!resp.ok) return [];
      const raw: unknown[] = await resp.json();
      return raw;
    }),
  );

  const items = events
    .flat()
    .map((raw) => normalizeDevFeedEvent(raw))
    .filter((item): item is Record<string, unknown> => item !== null)
    .sort((a, b) => (b.timestampUnix as number) - (a.timestampUnix as number));

  return {
    ok: true,
    status: 200,
    kind: "feed",
    owner,
    repo: null,
    branch: null,
    path: null,
    payload: { items, partial: false, errors: [] },
    error: null,
    rateLimitRemaining: null,
    rateLimitReset: null,
    authenticated: false,
  };
}

/** Minimal dev-fallback event normalizer — intentionally simpler than the Rust
 * bridge's `github_feed.rs::normalize_event` (no dependabot/"Bump " → "deps"
 * reclassification, no backtick path extraction, no per-kind `meta`/`badge`
 * derivation beyond a placeholder `meta`). Dev iteration only cares about
 * "the Feed tab renders something plausible without the desktop shell." */
function normalizeDevFeedEvent(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const event = raw as Record<string, unknown>;
  const type = event.type;
  const repoName = (event.repo as Record<string, unknown> | undefined)?.name;
  const actorLogin = (event.actor as Record<string, unknown> | undefined)?.login;
  const createdAt = event.created_at;
  if (typeof type !== "string" || typeof repoName !== "string" || typeof createdAt !== "string") return null;

  // Kind names match the real mock's FEED_KIND taxonomy (pr/merge/review/
  // comment/conflict/deps/issue/push/release) — "deps" not "dependency-bump".
  // This dev fallback does not attempt the dependabot/"Bump " reclassification
  // Task 3's Rust normalizer does; it always reports plain "push".
  const kindMap: Record<string, string> = {
    PushEvent: "push",
    PullRequestEvent: "pr",
    PullRequestReviewEvent: "review",
    IssuesEvent: "issue",
    ReleaseEvent: "release",
  };
  const kind = kindMap[type];
  if (!kind) return null;

  return {
    kind,
    repo: repoName,
    actor: typeof actorLogin === "string" ? actorLogin : "unknown",
    title: `${type} on ${repoName}`,
    url: `https://github.com/${repoName}`,
    path: null,
    num: null,
    meta: type,
    badge: null,
    timestampUnix: Math.floor(new Date(createdAt).getTime() / 1000),
  };
}
