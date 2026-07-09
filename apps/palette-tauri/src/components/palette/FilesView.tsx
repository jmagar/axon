import {
  ChevronRight,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileCog,
  FileText,
  Folder,
  Loader2,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/aurora/button";
import { ACTIONS, type RemotePaletteAction } from "@/lib/actions";
import { executeAction, type Client, type PaletteConfig } from "@/lib/axonClient";
import {
  breadcrumbSegments,
  fileKind,
  formatBytes,
  formatModified,
  isIngestable,
  isMarkdownLike,
  joinSegments,
  sortEntries,
  type DirListing,
  type FileContents,
  type FileEntry,
} from "@/lib/filesModel";
import { invoke, isTauriRuntime } from "@/lib/invoke";
import { strField, unwrapPayload } from "@/lib/payload";

interface FilesViewProps {
  client: Client | null;
  config: PaletteConfig | null;
}

type LoadState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; value: T }
  | { kind: "error"; message: string };

type IngestState = { kind: "idle" } | { kind: "running" } | { kind: "done"; ok: boolean; message: string };

/**
 * Local filesystem browser + preview/edit + ingest. Fully self-contained:
 * owns its own navigation/selection/edit state and calls the Tauri fs bridge
 * (`files_list_dir` / `files_read_file` / `files_write_file`) directly via the
 * shared `invoke()` wrapper. In the browser-dev fallback (no Tauri runtime)
 * those commands have no meaningful implementation, so this renders a clear
 * "requires the desktop app" message instead of attempting fs calls that will
 * always throw.
 */
export function FilesView({ client, config }: FilesViewProps) {
  const [cwd, setCwd] = useState("");
  const [listing, setListing] = useState<LoadState<DirListing>>({ kind: "idle" });
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [file, setFile] = useState<LoadState<FileContents>>({ kind: "idle" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [ingest, setIngest] = useState<IngestState>({ kind: "idle" });

  const loadDir = useCallback((path: string) => {
    setListing({ kind: "loading" });
    invoke<DirListing>("files_list_dir", { path: path || null })
      .then((value) => setListing({ kind: "loaded", value }))
      .catch((err) => setListing({ kind: "error", message: errorMessage(err) }));
  }, []);

  useEffect(() => {
    if (!isTauriRuntime) return;
    loadDir(cwd);
  }, [cwd, loadDir]);

  const loadFile = useCallback((path: string) => {
    setFile({ kind: "loading" });
    setEditing(false);
    setIngest({ kind: "idle" });
    invoke<FileContents>("files_read_file", { path })
      .then((value) => {
        setFile({ kind: "loaded", value });
        setDraft(value.content);
      })
      .catch((err) => setFile({ kind: "error", message: errorMessage(err) }));
  }, []);

  function openEntry(entry: FileEntry) {
    if (entry.isDir) {
      setSelected(null);
      setFile({ kind: "idle" });
      setCwd(entry.path);
      return;
    }
    setSelected(entry);
    loadFile(entry.path);
  }

  function goToBreadcrumb(index: number) {
    const segments = breadcrumbSegments(cwd);
    setCwd(joinSegments(segments.slice(0, index + 1)));
    setSelected(null);
    setFile({ kind: "idle" });
  }

  async function saveFile() {
    if (!selected) return;
    setSaving(true);
    try {
      const saved = await invoke<FileContents>("files_write_file", {
        path: selected.path,
        content: draft,
      });
      setFile({ kind: "loaded", value: saved });
      setEditing(false);
    } catch (err) {
      setFile({ kind: "error", message: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function ingestSelected() {
    if (!selected || !client || !config) return;
    const embedAction = ACTIONS.find(
      (action): action is RemotePaletteAction => action.subcommand === "embed" && action.kind !== "local",
    );
    if (!embedAction) {
      setIngest({ kind: "done", ok: false, message: "Embed action is unavailable." });
      return;
    }
    setIngest({ kind: "running" });
    const root = listing.kind === "loaded" ? listing.value.root : "";
    const absolutePath = `${root.replace(/\/+$/, "")}/${selected.path}`;
    const result = await executeAction(client, embedAction, absolutePath, config);
    if (result.ok) {
      setIngest({ kind: "done", ok: true, message: "Queued for ingest." });
    } else {
      const payload = unwrapPayload(result.payload);
      const message =
        strField(payload, "message") ?? strField(payload, "error") ?? `Ingest failed (HTTP ${result.status}).`;
      setIngest({ kind: "done", ok: false, message });
    }
  }

  if (!isTauriRuntime) {
    return (
      <div className="output-body operation-view files-view aurora-scrollbar">
        <div className="files-unavailable">
          <FileIcon size={22} strokeWidth={1.5} />
          <p>Files requires the desktop app.</p>
          <p className="operation-muted">
            Local filesystem access is only available when running the Axon Palette as a Tauri
            desktop app, not in the browser dev preview.
          </p>
        </div>
      </div>
    );
  }

  const segments = breadcrumbSegments(cwd);
  const entries = listing.kind === "loaded" ? sortEntries(listing.value.entries) : [];

  return (
    <div className="output-body operation-view files-view">
      <div className="files-toolbar">
        <nav className="files-breadcrumb" aria-label="Current directory">
          <Button variant="plain" size="unstyled" type="button" onClick={() => setCwd("")}>
            ~
          </Button>
          {segments.map((segment, index) => (
            <span
              key={segments.slice(0, index + 1).join("/")}
              className="files-breadcrumb-segment"
            >
              <ChevronRight size={12} />
              <Button variant="plain" size="unstyled" type="button" onClick={() => goToBreadcrumb(index)}>
                {segment}
              </Button>
            </span>
          ))}
        </nav>
        <Button
          variant="plain"
          size="unstyled"
          type="button"
          onClick={() => loadDir(cwd)}
          title="Refresh"
          aria-label="Refresh directory listing"
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      <div className="files-body">
        <div className="files-tree aurora-scrollbar" role="listbox" aria-label="Directory entries">
          {listing.kind === "loading" ? (
            <div className="files-empty">
              <Loader2 size={16} className="files-spin" />
              <span>Loading...</span>
            </div>
          ) : listing.kind === "error" ? (
            <div className="files-empty operation-muted">{listing.message}</div>
          ) : entries.length === 0 ? (
            <div className="files-empty operation-muted">Empty directory</div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                role="option"
                aria-selected={selected?.path === entry.path}
                className={`files-row${selected?.path === entry.path ? " files-row-active" : ""}`}
                onClick={() => openEntry(entry)}
              >
                <EntryIcon entry={entry} />
                <span className="files-row-name">{entry.name}</span>
                {!entry.isDir && <span className="files-row-size">{formatBytes(entry.size)}</span>}
              </button>
            ))
          )}
        </div>
        <div className="files-preview aurora-scrollbar">
          {!selected ? (
            <div className="files-empty operation-muted">Select a file</div>
          ) : file.kind === "loading" ? (
            <div className="files-empty">
              <Loader2 size={16} className="files-spin" />
              <span>Loading...</span>
            </div>
          ) : file.kind === "error" ? (
            <div className="files-empty operation-muted">{file.message}</div>
          ) : file.kind === "loaded" ? (
            <FilePreview
              selectedPath={selected.path}
              modifiedUnix={selected.modifiedUnix}
              file={file.value}
              editing={editing}
              draft={draft}
              saving={saving}
              ingest={ingest}
              canIngest={Boolean(client && config) && isIngestable(selected.name)}
              onEdit={() => setEditing(true)}
              onCancelEdit={() => {
                setEditing(false);
                setDraft(file.value.content);
              }}
              onDraftChange={setDraft}
              onSave={() => void saveFile()}
              onIngest={() => void ingestSelected()}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EntryIcon({ entry }: { entry: FileEntry }) {
  if (entry.isDir) return <Folder size={15} className="files-icon-dir" aria-hidden="true" />;
  const kind = fileKind(entry.name);
  switch (kind) {
    case "doc":
      return <FileText size={15} className="files-icon-doc" aria-hidden="true" />;
    case "code":
      return <FileCode size={15} className="files-icon-code" aria-hidden="true" />;
    case "config":
      return <FileCog size={15} className="files-icon-config" aria-hidden="true" />;
    case "archive":
      return <FileArchive size={15} className="files-icon-muted" aria-hidden="true" />;
    default:
      return <FileIcon size={15} className="files-icon-muted" aria-hidden="true" />;
  }
}

function FilePreview({
  selectedPath,
  modifiedUnix,
  file,
  editing,
  draft,
  saving,
  ingest,
  canIngest,
  onEdit,
  onCancelEdit,
  onDraftChange,
  onSave,
  onIngest,
}: {
  selectedPath: string;
  modifiedUnix?: number | null;
  file: FileContents;
  editing: boolean;
  draft: string;
  saving: boolean;
  ingest: IngestState;
  canIngest: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onIngest: () => void;
}) {
  const name = selectedPath.split("/").pop() ?? selectedPath;
  return (
    <div className="files-preview-inner">
      <div className="files-preview-header">
        <span className="files-preview-name">{name}</span>
        <span className="files-preview-meta">
          {formatBytes(file.size)} · modified {formatModified(modifiedUnix)}
        </span>
        <div className="files-preview-actions">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" type="button" onClick={onCancelEdit}>
                Cancel
              </Button>
              <Button variant="aurora" size="sm" type="button" onClick={onSave} disabled={saving}>
                <Save size={13} />
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" type="button" onClick={onEdit}>
                Edit
              </Button>
              {canIngest && (
                <Button
                  variant="aurora"
                  size="sm"
                  type="button"
                  onClick={onIngest}
                  disabled={ingest.kind === "running"}
                >
                  <Upload size={13} />
                  {ingest.kind === "running" ? "Ingesting..." : "Ingest"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {ingest.kind === "done" && (
        <div className={`files-ingest-status${ingest.ok ? "" : " files-ingest-status-error"}`}>
          {ingest.message}
        </div>
      )}
      {editing ? (
        <textarea
          className="files-editor"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          spellCheck={false}
        />
      ) : isMarkdownLike(name) ? (
        <pre className="files-preview-text">{file.content}</pre>
      ) : (
        <pre className="files-preview-text files-preview-code">
          <code>{file.content}</code>
        </pre>
      )}
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
