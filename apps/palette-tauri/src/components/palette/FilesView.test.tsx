// @vitest-environment jsdom
//
// Behavioral tests for FilesView: the browser-dev fallback message when
// `isTauriRuntime` is false, directory listing + navigation + file preview
// against a mocked Tauri fs bridge, and the real ingest wiring — proving it
// dispatches through `axon_http_request` with the same shape the `embed`
// action would build (POST /v1/embed with the file's absolute path).

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = vi.hoisted(() => ({ isTauriRuntime: true }));
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/invoke", () => ({
  get isTauriRuntime() {
    return runtimeState.isTauriRuntime;
  },
  invoke: invokeMock,
}));

import { FilesView } from "./FilesView";
import { createAxonClient, type PaletteConfig } from "@/lib/axonClient";
import type { DirListing, FileContents } from "@/lib/filesModel";

const config: PaletteConfig = {
  serverUrl: "http://127.0.0.1:8001",
  token: null,
  shortcut: "Ctrl+Shift+Space",
  collection: "axon",
  resultLimit: 10,
  theme: "dark",
  hideOnBlur: false,
};
const client = createAxonClient(config);

const rootListing: DirListing = {
  path: "",
  root: "/home/user",
  entries: [
    { name: "notes", path: "notes", isDir: true, size: 0, modifiedUnix: null },
    { name: "README.md", path: "README.md", isDir: false, size: 128, modifiedUnix: 1_700_000_000 },
    { name: "photo.png", path: "photo.png", isDir: false, size: 2048, modifiedUnix: null },
  ],
};

const readmeContents: FileContents = {
  path: "README.md",
  content: "# Hello\n\nSome docs.",
  size: 128,
};

beforeEach(() => {
  runtimeState.isTauriRuntime = true;
  invokeMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("FilesView — browser dev fallback", () => {
  it("shows a requires-desktop-app message and never calls invoke", () => {
    runtimeState.isTauriRuntime = false;
    render(<FilesView client={null} config={null} />);

    expect(screen.getByText(/requires the desktop app/i)).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("FilesView — directory listing", () => {
  it("lists directory entries and lets the user open a file", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "files_list_dir") return Promise.resolve(rootListing);
      if (command === "files_read_file") return Promise.resolve(readmeContents);
      throw new Error(`unexpected command: ${command}`);
    });

    render(<FilesView client={client} config={config} />);

    await waitFor(() => expect(screen.getByText("README.md")).toBeInTheDocument());
    expect(screen.getByText("notes")).toBeInTheDocument();
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("Select a file")).toBeInTheDocument();

    fireEvent.click(screen.getByText("README.md"));

    await waitFor(() => expect(screen.getByText(/# Hello/)).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith("files_read_file", { path: "README.md" });
  });

  it("navigates into a subdirectory and lists its contents", async () => {
    const nestedListing: DirListing = {
      path: "notes",
      root: "/home/user",
      entries: [{ name: "todo.txt", path: "notes/todo.txt", isDir: false, size: 12, modifiedUnix: null }],
    };
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "files_list_dir") {
        return Promise.resolve(args?.path === "notes" ? nestedListing : rootListing);
      }
      throw new Error(`unexpected command: ${command}`);
    });

    render(<FilesView client={client} config={config} />);
    await waitFor(() => expect(screen.getByText("notes")).toBeInTheDocument());

    fireEvent.click(screen.getByText("notes"));

    await waitFor(() => expect(screen.getByText("todo.txt")).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith("files_list_dir", { path: "notes" });
  });

  it("shows an error message when listing fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "files_list_dir") return Promise.reject(new Error("path escapes the allowed files root"));
      throw new Error(`unexpected command: ${command}`);
    });

    render(<FilesView client={client} config={config} />);

    await waitFor(() =>
      expect(screen.getByText(/path escapes the allowed files root/)).toBeInTheDocument(),
    );
  });
});

describe("FilesView — real ingest wiring", () => {
  it("ingests the selected file via the real embed request shape", async () => {
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "files_list_dir") return Promise.resolve(rootListing);
      if (command === "files_read_file") return Promise.resolve(readmeContents);
      if (command === "axon_http_request") {
        const request = args?.request as { method: string; path: string; body: unknown };
        expect(request.method).toBe("POST");
        expect(request.path).toBe("/v1/embed");
        expect(request.body).toEqual({ input: "/home/user/README.md", collection: "axon" });
        return Promise.resolve({ ok: true, status: 200, path: "/v1/embed", method: "POST", payload: { job_id: "abc" } });
      }
      throw new Error(`unexpected command: ${command}`);
    });

    render(<FilesView client={client} config={config} />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("README.md"));
    await waitFor(() => expect(screen.getByRole("button", { name: /ingest/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /ingest/i }));

    await waitFor(() => expect(screen.getByText(/Queued for ingest/i)).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith(
      "axon_http_request",
      expect.objectContaining({
        request: expect.objectContaining({ method: "POST", path: "/v1/embed" }),
      }),
    );
  });

  it("does not offer ingest for a non-ingestable (binary) file", async () => {
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "files_list_dir") return Promise.resolve(rootListing);
      if (command === "files_read_file" && args?.path === "photo.png") {
        return Promise.reject(new Error("file is not valid UTF-8 text"));
      }
      throw new Error(`unexpected command: ${command}`);
    });

    render(<FilesView client={client} config={config} />);
    await waitFor(() => expect(screen.getByText("photo.png")).toBeInTheDocument());
    fireEvent.click(screen.getByText("photo.png"));

    await waitFor(() => expect(screen.getByText(/not valid UTF-8/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /ingest/i })).not.toBeInTheDocument();
  });

  it("shows a failure message when the ingest request fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "files_list_dir") return Promise.resolve(rootListing);
      if (command === "files_read_file") return Promise.resolve(readmeContents);
      if (command === "axon_http_request") {
        return Promise.resolve({
          ok: false,
          status: 500,
          path: "/v1/embed",
          method: "POST",
          payload: { message: "TEI unreachable" },
        });
      }
      throw new Error(`unexpected command: ${command}`);
    });

    render(<FilesView client={client} config={config} />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("README.md"));
    await waitFor(() => expect(screen.getByRole("button", { name: /ingest/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /ingest/i }));

    await waitFor(() => expect(screen.getByText(/TEI unreachable/)).toBeInTheDocument());
  });
});

describe("FilesView — edit and save", () => {
  it("edits and saves a file via files_write_file", async () => {
    const savedContents: FileContents = { path: "README.md", content: "# Edited", size: 8 };
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "files_list_dir") return Promise.resolve(rootListing);
      if (command === "files_read_file") return Promise.resolve(readmeContents);
      if (command === "files_write_file") {
        expect(args?.path).toBe("README.md");
        return Promise.resolve(savedContents);
      }
      throw new Error(`unexpected command: ${command}`);
    });

    render(<FilesView client={client} config={config} />);
    await waitFor(() => expect(screen.getByText("README.md")).toBeInTheDocument());
    fireEvent.click(screen.getByText("README.md"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "# Edited" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("files_write_file", { path: "README.md", content: "# Edited" }),
    );
  });
});
