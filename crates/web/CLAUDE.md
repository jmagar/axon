# crates/web — Axon Web UI Server

Axum-based web server that provides a browser UI for executing CLI commands and monitoring Docker container stats in real time.

## Architecture

```
crates/
├── web.rs              # Axum router, WS handler, static asset serving
└── web/
    ├── execute.rs      # Subprocess execution + stdout/stderr streaming
    ├── docker_stats.rs # Bollard Docker stats poller + broadcast
    └── static/         # Frontend assets
        ├── index.html  # HTML shell
        ├── style.css   # All styles
        ├── neural.js   # Neural canvas animation (bioluminescent blue)
        └── app.js      # UI logic: omnibox, WS, command execution, rendering
```

## Key Design Decisions

### Single port, single binary
All static assets are compiled into the binary via `include_str!()` in release builds. No runtime file dependencies. In debug builds, assets are read from disk on every request for hot reload.

### Subprocess execution (not in-process)
Commands run as `tokio::process::Command(self_exe, mode, "--json", "--wait", "true", input)`. This isolates crashes — a failing command doesn't take down the server. Both stdout (JSON data) and stderr (progress/logs) are streamed concurrently over WebSocket.

### Single WebSocket, multiplexed by `type`
No separate connections for commands vs Docker stats. Message types:
- `execute` / `cancel` — client → server
- `output` — server → client (stdout lines from subprocess)
- `log` — server → client (stderr lines: spinner progress, tracing)
- `done` / `error` — server → client (command completion)
- `stats` — server → client (Docker container metrics broadcast)

### ANSI stripping
All subprocess output is stripped of ANSI escape codes via `console::strip_ansi_codes()` before sending to the browser.

### Security: whitelist-only flag mapping
Only known command modes and flag names are passed to the subprocess. Raw user input is never interpolated into args. See `ALLOWED_MODES` and `ALLOWED_FLAGS` in `execute.rs`.

## Static Assets

### Hot Reload (debug builds)
`#[cfg(debug_assertions)]` handlers read files from disk at `CARGO_MANIFEST_DIR/crates/web/static/`. Edit any file and refresh — no rebuild needed.

### Release builds
`#[cfg(not(debug_assertions))]` handlers serve `include_str!()` constants. All assets baked into the binary.

### neural.js
Canvas animation with depth-based rendering, volumetric glow, and bokeh particle field. Color scheme: bioluminescent blue (`core/bright/mid/dim/faint`). Exports `window.neurons`, `window.signals`, `window.setNeuralIntensity`, `window.isProcessing` for app.js integration.

### app.js
- `NO_INPUT_MODES` — commands that auto-execute on dropdown selection (stats, status, doctor, etc.)
- `parseMarkdown()` — lightweight markdown→HTML parser (headings, code blocks, tables, lists, inline formatting)
- `renderJsonOutput()` — dispatches by JSON shape: `markdown` field → scrape, `answer` → ask, `rank+snippet` → query
- `renderObjectAsHtml()` — recursive key-value renderer for generic JSON (no raw JSON ever displayed)
- `handleLog()` — renders stderr progress lines as subtle status updates

## Docker Stats (bollard)

`docker_stats.rs` polls Docker via `bollard::Docker::connect_with_local_defaults()` every 500ms. Computes CPU%, memory, net I/O rates per container. Broadcasts to all WS clients. Gracefully degrades if Docker socket is unavailable.

## Adding a New Command Mode

1. Add the mode string to `ALLOWED_MODES` in `execute.rs`
2. If it needs new flags, add entries to `ALLOWED_FLAGS`
3. No JS changes needed unless the JSON output shape needs special rendering (add a case in `renderJsonOutput()`)

## Gotchas

- `Spinner` (indicatif) writes to stderr, not stdout — that's why we stream both
- `log_info`/`log_done` go through tracing which writes to stderr
- The `--json` flag only affects stdout format, not stderr
- Docker stats use container name prefix matching (`axon-*`) — rename containers and stats break
- `include_str!()` paths are relative to the `.rs` file, not the crate root
