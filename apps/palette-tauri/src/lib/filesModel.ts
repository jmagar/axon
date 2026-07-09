// Pure helpers for the "Files" local action (FilesView.tsx). Kept out of the
// component per the palette convention: business logic lives in src/lib/*,
// components stay thin renderers over props/state.

export interface FileEntry {
  name: string;
  /** Path relative to the allowed files root (forward-slash separated). */
  path: string;
  isDir: boolean;
  size: number;
  /** Unix seconds since epoch, when the filesystem provided one. */
  modifiedUnix?: number | null;
}

export interface DirListing {
  /** Path relative to the allowed files root ("" for the root itself). */
  path: string;
  root: string;
  entries: FileEntry[];
}

export interface FileContents {
  path: string;
  content: string;
  size: number;
}

/** Human-readable byte size, matching the mock's `fmtBytes` scale (B/KB/MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Relative "time ago" label for a Unix-seconds timestamp, or "-" when absent. */
export function formatModified(unixSeconds: number | null | undefined, nowMs = Date.now()): string {
  if (unixSeconds == null) return "-";
  const deltaMs = nowMs - unixSeconds * 1000;
  if (deltaMs < 0) return "just now";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (deltaMs < minute) return "just now";
  if (deltaMs < hour) return `${Math.floor(deltaMs / minute)}m ago`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h ago`;
  if (deltaMs < 30 * day) return `${Math.floor(deltaMs / day)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

/** Split a root-relative path into breadcrumb segments (empty for the root). */
export function breadcrumbSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** Join breadcrumb segments back into a root-relative path. */
export function joinSegments(segments: string[]): string {
  return segments.join("/");
}

/** Root-relative path of a directory entry's parent ("" at the root). */
export function parentPath(path: string): string {
  const segments = breadcrumbSegments(path);
  return joinSegments(segments.slice(0, -1));
}

/** Join a directory's root-relative path with a child entry name. */
export function childPath(dirPath: string, name: string): string {
  return dirPath ? `${dirPath}/${name}` : name;
}

const CODE_EXTENSIONS = new Set([
  "rs", "ts", "tsx", "js", "jsx", "py", "go", "css", "html", "sh", "bash", "toml",
]);
const DOC_EXTENSIONS = new Set(["md", "mdx", "txt", "rst"]);
const CONFIG_EXTENSIONS = new Set(["json", "jsonl", "yaml", "yml", "ini", "env", "lock"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "tar", "gz", "bz2", "xz", "7z"]);
const KNOWN_BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp",
  "pdf", "woff", "woff2", "ttf", "otf",
  "mp3", "mp4", "mov", "avi", "wasm", "so", "dylib", "dll", "exe", "bin",
]);

export type FileKind = "doc" | "code" | "config" | "archive" | "binary" | "text";

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function fileKind(name: string): FileKind {
  const ext = extensionOf(name);
  if (DOC_EXTENSIONS.has(ext)) return "doc";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (CONFIG_EXTENSIONS.has(ext)) return "config";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (KNOWN_BINARY_EXTENSIONS.has(ext)) return "binary";
  return "text";
}

/** Whether a file kind is worth offering an "Ingest" action for. Archives and
 * known-binary extensions are excluded — embedding a zip/image as text markdown
 * is not useful and the read path would reject non-UTF-8 content anyway. */
export function isIngestable(name: string): boolean {
  const kind = fileKind(name);
  return kind !== "archive" && kind !== "binary";
}

export function isMarkdownLike(name: string): boolean {
  return fileKind(name) === "doc";
}

/** Sort directories first, then case-insensitive name. Mirrors the Rust-side
 * `files_list_dir` ordering so client-side re-sorts (if any) stay consistent. */
export function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}
