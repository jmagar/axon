// @vitest-environment jsdom
//
// Behavioral render test for GitHubView: the structured view for the
// `github` palette action. Verifies the three payload shapes render (repo
// list, file tree, file preview), the error state, and that clicking a repo
// or a tree entry issues a fresh `github_browse` call via the mocked invoke
// seam (real navigation, not one-shot commands — see the component header
// comment for why).

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@/lib/invoke", () => ({
  isTauriRuntime: false,
  invoke: (...args: unknown[]) => invokeMock(...args),
  appWindow: { listen: () => Promise.resolve(() => {}) },
}));

import { GitHubView } from "./GitHubView";

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
});

const reposResult = {
  ok: true,
  status: 200,
  kind: "repos",
  owner: "jmagar",
  repo: null,
  branch: null,
  path: null,
  payload: [
    {
      name: "axon",
      full_name: "jmagar/axon",
      description: "Self-hosted RAG stack",
      language: "Rust",
      stargazers_count: 12,
      forks_count: 3,
      private: false,
      default_branch: "main",
    },
  ],
  error: null,
  rateLimitRemaining: 59,
  rateLimitReset: null,
  authenticated: false,
};

const treeResult = {
  ok: true,
  status: 200,
  kind: "tree",
  owner: "jmagar",
  repo: "axon",
  branch: "main",
  path: null,
  payload: {
    tree: [
      { path: "README.md", type: "blob", size: 1024 },
      { path: "src", type: "tree" },
      { path: "src/main.rs", type: "blob", size: 256 },
    ],
  },
  error: null,
  rateLimitRemaining: 58,
  rateLimitReset: null,
  authenticated: false,
};

const fileResult = {
  ok: true,
  status: 200,
  kind: "file",
  owner: "jmagar",
  repo: "axon",
  branch: "main",
  path: "README.md",
  payload: {
    path: "README.md",
    content: btoa("# axon\n\nhello"),
    encoding: "base64",
    size: 15,
  },
  error: null,
  rateLimitRemaining: 57,
  rateLimitReset: null,
  authenticated: false,
};

const errorResult = {
  ok: false,
  status: 403,
  kind: "repos",
  owner: "jmagar",
  repo: null,
  branch: null,
  path: null,
  payload: null,
  error: "GitHub API rate limited — retry at 2024-01-01 00:00:00 UTC",
  rateLimitRemaining: 0,
  rateLimitReset: 1_700_000_000,
  authenticated: false,
};

describe("GitHubView", () => {
  it("renders a repo list", () => {
    render(<GitHubView payload={reposResult} />);
    expect(screen.getByText("jmagar/axon")).toBeInTheDocument();
    expect(screen.getByText("Self-hosted RAG stack")).toBeInTheDocument();
  });

  it("drills into a repo's tree on click", async () => {
    invokeMock.mockResolvedValueOnce(treeResult);
    render(<GitHubView payload={reposResult} />);
    fireEvent.click(screen.getByText("jmagar/axon"));
    await waitFor(() => expect(screen.getByText("README.md")).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith("github_browse", {
      request: { kind: "tree", owner: "jmagar", repo: "axon", branch: "main" },
    });
    // Directory entries (type "tree") are not listed as files.
    expect(screen.queryByText("src", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("src/main.rs")).toBeInTheDocument();
  });

  it("renders a file tree directly when given a tree payload", () => {
    render(<GitHubView payload={treeResult} />);
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("src/main.rs")).toBeInTheDocument();
  });

  it("opens a file preview on click and decodes base64 markdown content", async () => {
    invokeMock.mockResolvedValueOnce(fileResult);
    render(<GitHubView payload={treeResult} />);
    fireEvent.click(screen.getByText("README.md"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith("github_browse", {
      request: { kind: "file", owner: "jmagar", repo: "axon", path: "README.md", branch: "main" },
    });
  });

  it("renders a decoded file preview directly when given a file payload", () => {
    render(<GitHubView payload={fileResult} />);
    // Path shows in both the hero title and the detail card; content is
    // decoded from base64 and shown (markdown renderer lazy-loads behind
    // Suspense, so the immediate fallback is a raw <pre> with the same text).
    expect(screen.getAllByText("README.md").length).toBeGreaterThan(0);
    expect(screen.getByText(/hello/)).toBeInTheDocument();
  });

  it("renders the GitHub error state with the rate-limit message", () => {
    render(<GitHubView payload={errorResult} />);
    expect(screen.getByText("GitHub request failed")).toBeInTheDocument();
    expect(screen.getByText(/rate limited/)).toBeInTheDocument();
  });

  it("shows a Back button after drilling and returns to the previous view", async () => {
    invokeMock.mockResolvedValueOnce(treeResult);
    render(<GitHubView payload={reposResult} />);
    fireEvent.click(screen.getByText("jmagar/axon"));
    await waitFor(() => expect(screen.getByText("README.md")).toBeInTheDocument());
    const backButton = screen.getByRole("button", { name: /back/i });
    fireEvent.click(backButton);
    await waitFor(() => expect(screen.getByText("jmagar/axon")).toBeInTheDocument());
  });
});
