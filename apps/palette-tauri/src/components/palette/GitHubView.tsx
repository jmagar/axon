import { memo, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, File, FolderGit2, Loader2 } from "lucide-react";

import { MarkdownBody } from "@/components/palette/MarkdownBody";
import { DetailLine, EmptyResult, ResultHero } from "@/components/palette/OperationResultViewShared";
import type { GitHubBrowseResult } from "@/lib/actionRequest";
import { invoke } from "@/lib/invoke";
import { isRecord } from "@/lib/payload";

export type { GitHubBrowseResult } from "@/lib/actionRequest";

interface GitHubBrowseRequest {
  kind: "repos" | "repo" | "tree" | "file";
  owner: string;
  repo?: string;
  branch?: string;
  path?: string;
}

interface RepoSummary {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  private: boolean;
  default_branch: string;
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree" | string;
  size?: number;
}

interface FileContents {
  path: string;
  content?: string;
  encoding?: string;
  size?: number;
  truncated?: boolean;
}

async function browse(request: GitHubBrowseRequest): Promise<GitHubBrowseResult> {
  return invoke<GitHubBrowseResult>("github_browse", { request });
}

/**
 * Structured view for the `github` palette action — real GitHub browsing via
 * the `github_browse` Tauri command (never a direct renderer fetch; the
 * desktop CSP `connect-src` has no `api.github.com` origin — see the header
 * comment in `src-tauri/src/github_bridge.rs`).
 *
 * The initial payload comes from the dispatched action (`owner`,
 * `owner/repo`, or `owner/repo/path`); clicking a repo or a tree entry issues
 * a fresh `github_browse` call directly so browsing feels like real
 * navigation rather than one-shot palette commands. Each response echoes back
 * its own `owner`/`repo`/`branch`/`path`, so navigation state is reconstructed
 * from the response itself rather than guessed at from the GitHub JSON shape.
 */
export const GitHubView = memo(function GitHubView({ payload }: { payload: Record<string, unknown> }) {
  const initial = payload as unknown as GitHubBrowseResult;
  const [history, setHistory] = useState<GitHubBrowseResult[]>([initial]);
  const [loading, setLoading] = useState(false);
  const current = history[history.length - 1];

  async function go(request: GitHubBrowseRequest) {
    setLoading(true);
    try {
      const result = await browse(request);
      setHistory((prev) => [...prev, result]);
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }

  if (!current.ok) {
    return (
      <div className="output-body operation-view aurora-scrollbar">
        <ResultHero
          icon={<AlertTriangle size={16} />}
          title="GitHub request failed"
          tone="warn"
          metrics={[
            ["Status", current.status || "-"],
            ["Authenticated", current.authenticated ? "yes" : "no"],
          ]}
        />
        <section className="operation-section">
          <p className="operation-muted">{current.error ?? "Unknown GitHub error."}</p>
        </section>
        {history.length > 1 ? (
          <button type="button" className="github-back" onClick={goBack}>
            <ChevronLeft size={13} /> Back
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="output-body operation-view aurora-scrollbar github-view">
      <div className="github-header">
        <ResultHero
          icon={loading ? <Loader2 size={16} className="github-spin" /> : <FolderGit2 size={16} />}
          title={githubTitle(current)}
          tone="neutral"
          metrics={[
            ["Rate limit", current.rateLimitRemaining ?? "-"],
            ["Auth", current.authenticated ? "token" : "anonymous"],
          ]}
        />
        {history.length > 1 ? (
          <button type="button" className="github-back" onClick={goBack} disabled={loading}>
            <ChevronLeft size={13} /> Back
          </button>
        ) : null}
      </div>
      {current.kind === "repos" ? (
        <RepoListView
          payload={current.payload}
          onOpenRepo={(repo) =>
            go({ kind: "tree", owner: current.owner, repo: repo.name, branch: repo.default_branch })
          }
        />
      ) : current.kind === "tree" ? (
        <TreeView
          payload={current.payload}
          onOpenFile={(path) =>
            go({
              kind: "file",
              owner: current.owner,
              repo: current.repo ?? "",
              path,
              branch: current.branch ?? undefined,
            })
          }
        />
      ) : (
        <FilePreview payload={current.payload} />
      )}
    </div>
  );
});

function githubTitle(result: GitHubBrowseResult): string {
  switch (result.kind) {
    case "repos":
      return `${result.owner}'s repositories`;
    case "tree":
      return `${result.owner}/${result.repo}${result.branch ? ` @ ${result.branch}` : ""}`;
    case "file":
      return result.path ?? "File preview";
    default:
      return "GitHub";
  }
}

function RepoListView({
  payload,
  onOpenRepo,
}: {
  payload: unknown;
  onOpenRepo: (repo: RepoSummary) => void;
}) {
  const repos = useMemo(() => (Array.isArray(payload) ? (payload as RepoSummary[]) : []), [payload]);
  if (repos.length === 0) return <EmptyResult kind="generic" />;
  return (
    <section className="operation-section">
      <div className="github-repo-list">
        {repos.map((repo) => (
          <button key={repo.full_name} type="button" className="github-repo-row" onClick={() => onOpenRepo(repo)}>
            <div className="github-repo-main">
              <span className="github-repo-name">{repo.full_name}</span>
              {repo.private ? <span className="github-repo-badge">Private</span> : null}
            </div>
            {repo.description ? <p className="operation-muted">{repo.description}</p> : null}
            <div className="github-repo-meta">
              {repo.language ? <span>{repo.language}</span> : null}
              <span>★ {repo.stargazers_count}</span>
              <span>⑂ {repo.forks_count}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function TreeView({ payload, onOpenFile }: { payload: unknown; onOpenFile: (path: string) => void }) {
  const entries = useMemo(() => {
    const tree = isRecord(payload) ? payload.tree : undefined;
    return Array.isArray(tree) ? (tree as TreeEntry[]) : [];
  }, [payload]);
  const files = entries.filter((entry) => entry.type === "blob").sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) return <EmptyResult kind="generic" />;
  return (
    <section className="operation-section">
      <div className="github-tree-list">
        {files.slice(0, 300).map((entry) => (
          <button key={entry.path} type="button" className="github-tree-row" onClick={() => onOpenFile(entry.path)}>
            <File size={13} />
            <span className="github-tree-path">{entry.path}</span>
            {typeof entry.size === "number" ? <span className="github-tree-size">{formatBytes(entry.size)}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function FilePreview({ payload }: { payload: unknown }) {
  const file = isRecord(payload) ? (payload as unknown as FileContents) : null;
  if (!file) return <EmptyResult kind="generic" />;
  const decoded = decodeFileContent(file);
  return (
    <>
      <section className="operation-section">
        <div className="operation-detail-card">
          <DetailLine label="Path" value={file.path ?? "-"} mono />
          <DetailLine label="Size" value={typeof file.size === "number" ? formatBytes(file.size) : "-"} mono />
        </div>
      </section>
      <section className="operation-section operation-reader-section">
        {file.truncated ? (
          <p className="operation-muted">File too large to preview inline.</p>
        ) : decoded !== null ? (
          <div className="operation-reader">
            {isMarkdownPath(file.path) ? (
              <MarkdownBody>{decoded}</MarkdownBody>
            ) : (
              <pre className="output-body output-code github-file-code">{decoded}</pre>
            )}
          </div>
        ) : (
          <p className="operation-muted">Unable to decode file contents.</p>
        )}
      </section>
    </>
  );
}

function decodeFileContent(file: FileContents): string | null {
  if (typeof file.content !== "string" || !file.content) return null;
  try {
    if (file.encoding && file.encoding !== "base64") return file.content;
    const normalized = file.content.replace(/\n/g, "");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function isMarkdownPath(path: string | undefined | null): boolean {
  return Boolean(path && /\.(md|mdx)$/i.test(path));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
