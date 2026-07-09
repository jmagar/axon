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
