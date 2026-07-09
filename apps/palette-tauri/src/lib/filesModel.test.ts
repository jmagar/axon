import { describe, expect, it } from "vitest";

import {
  breadcrumbSegments,
  childPath,
  extensionOf,
  fileKind,
  formatBytes,
  formatModified,
  isIngestable,
  isMarkdownLike,
  joinSegments,
  parentPath,
  sortEntries,
  type FileEntry,
} from "./filesModel";

describe("formatBytes", () => {
  it("formats bytes under 1024 verbatim", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes with one decimal under 10KB", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats kilobytes without decimals at/above 10KB", () => {
    expect(formatBytes(20480)).toBe("20 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatModified", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  it("returns '-' for missing timestamps", () => {
    expect(formatModified(null, now)).toBe("-");
    expect(formatModified(undefined, now)).toBe("-");
  });

  it("returns 'just now' for very recent / future timestamps", () => {
    expect(formatModified(now / 1000, now)).toBe("just now");
    expect(formatModified(now / 1000 + 10, now)).toBe("just now");
  });

  it("returns minutes/hours/days ago for recent timestamps", () => {
    expect(formatModified(now / 1000 - 5 * 60, now)).toBe("5m ago");
    expect(formatModified(now / 1000 - 3 * 3600, now)).toBe("3h ago");
    expect(formatModified(now / 1000 - 2 * 86400, now)).toBe("2d ago");
  });

  it("falls back to a locale date beyond 30 days", () => {
    const old = now / 1000 - 40 * 86400;
    expect(formatModified(old, now)).toBe(new Date(old * 1000).toLocaleDateString());
  });
});

describe("breadcrumb / path helpers", () => {
  it("splits a path into segments and rejoins it", () => {
    expect(breadcrumbSegments("projects/axon/src")).toEqual(["projects", "axon", "src"]);
    expect(joinSegments(["projects", "axon", "src"])).toBe("projects/axon/src");
  });

  it("treats an empty path as the root with no segments", () => {
    expect(breadcrumbSegments("")).toEqual([]);
    expect(joinSegments([])).toBe("");
  });

  it("computes the parent of a nested path", () => {
    expect(parentPath("projects/axon/src")).toBe("projects/axon");
    expect(parentPath("projects")).toBe("");
    expect(parentPath("")).toBe("");
  });

  it("joins a directory path with a child name", () => {
    expect(childPath("", "notes")).toBe("notes");
    expect(childPath("projects/axon", "README.md")).toBe("projects/axon/README.md");
  });
});

describe("extensionOf / fileKind", () => {
  it("lowercases and strips the leading dot", () => {
    expect(extensionOf("README.MD")).toBe("md");
    expect(extensionOf("Cargo.toml")).toBe("toml");
  });

  it("returns empty string for extension-less or dotfile-only names", () => {
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });

  it("classifies doc/code/config/archive/binary/text kinds", () => {
    expect(fileKind("README.md")).toBe("doc");
    expect(fileKind("main.rs")).toBe("code");
    expect(fileKind("config.json")).toBe("config");
    expect(fileKind("archive.zip")).toBe("archive");
    expect(fileKind("photo.png")).toBe("binary");
    expect(fileKind("data.unknownext")).toBe("text");
  });
});

describe("isIngestable / isMarkdownLike", () => {
  it("excludes archives and known binaries from ingest", () => {
    expect(isIngestable("archive.zip")).toBe(false);
    expect(isIngestable("photo.png")).toBe(false);
    expect(isIngestable("main.rs")).toBe(true);
    expect(isIngestable("README.md")).toBe(true);
    expect(isIngestable("notes.txt")).toBe(true);
  });

  it("flags only doc-like extensions as markdown-renderable", () => {
    expect(isMarkdownLike("README.md")).toBe(true);
    expect(isMarkdownLike("notes.txt")).toBe(true);
    expect(isMarkdownLike("main.rs")).toBe(false);
  });
});

describe("sortEntries", () => {
  it("sorts directories before files, then case-insensitively by name", () => {
    const entries: FileEntry[] = [
      { name: "zeta.txt", path: "zeta.txt", isDir: false, size: 1 },
      { name: "Beta", path: "Beta", isDir: true, size: 0 },
      { name: "alpha.txt", path: "alpha.txt", isDir: false, size: 2 },
      { name: "adam", path: "adam", isDir: true, size: 0 },
    ];
    const sorted = sortEntries(entries).map((e) => e.name);
    expect(sorted).toEqual(["adam", "Beta", "alpha.txt", "zeta.txt"]);
  });

  it("does not mutate the input array", () => {
    const entries: FileEntry[] = [{ name: "b", path: "b", isDir: false, size: 0 }];
    const copy = [...entries];
    sortEntries(entries);
    expect(entries).toEqual(copy);
  });
});
