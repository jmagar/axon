# `axon serve` — Web UI

Starts a native web UI server that provides a browser-based interface for all Axon commands, with real-time Docker container stats driving a neural network canvas animation.

## Usage

```bash
axon serve              # default port 3939
axon serve --port 8080  # custom port
```

Then open `http://localhost:3939` in a browser.

## Architecture

```
Browser ──────▶ axum (single port, single binary)
                │
                ├── GET /              → index.html (compiled into binary)
                ├── GET /style.css     → style.css  (compiled into binary)
                ├── GET /neural.js     → neural.js  (compiled into binary)
                ├── GET /app.js        → app.js     (compiled into binary)
                │
                └── WS /ws             → multiplexed by "type" field
                    │
                    ├── client→server: {"type":"execute","mode":"scrape","input":"https://...","flags":{}}
                    │   server spawns: tokio::process::Command("axon scrape --json --wait true ...")
                    │   server→client: {"type":"output","line":"..."} per stdout line
                    │   server→client: {"type":"done","exit_code":0,"elapsed_ms":1823}
                    │
                    ├── client→server: {"type":"cancel","id":"<job_uuid>"}
                    │   server spawns: axon crawl cancel <id> --json
                    │
                    └── server→client (broadcast): {"type":"stats","containers":{...},"aggregate":{...}}
                        └── bollard polls Docker socket every 500ms
```

## Key Design Decisions

1. **Subprocess execution** — Commands run via `tokio::process::Command` spawning the same binary with `--json --wait true`. This means zero refactoring of existing commands, and a crashing command doesn't take down the server.

2. **`std::env::current_exe()`** — The server spawns itself with different args. Single binary, no external dependencies.

3. **`include_str!()`** — All static assets are compiled into the binary at build time. Zero runtime file dependencies, zero file I/O for serving.

4. **Single WebSocket, multiplexed** — One WebSocket at `/ws` handles both command execution responses and Docker stats broadcasts. No separate connections needed.

5. **Flag whitelisting** — Only known flag names (`--max-pages`, `--limit`, `--collection`, etc.) are passed through to subprocess args. User input is never used as raw CLI args (command injection prevention).

6. **Bollard graceful degradation** — If the Docker socket is unavailable, stats broadcasting is silently disabled. The server still works for command execution.

## Modules

| File | Purpose | Lines |
|------|---------|-------|
| `crates/web.rs` | Axum server, routes, WS handler, shared state | ~177 |
| `crates/web/execute.rs` | Subprocess spawn, stdout streaming, flag whitelist | ~236 |
| `crates/web/docker_stats.rs` | Bollard Docker stats poller, rate calculations, broadcast | ~281 |
| `crates/cli/commands/serve.rs` | `run_serve()` entry point | ~6 |

## Static Assets

All in `crates/web/static/`, embedded via `include_str!()`:

| File | Purpose |
|------|---------|
| `index.html` | HTML shell — structure only, refs to CSS/JS. 16 command modes in the dropdown. |
| `style.css` | Mobile-first responsive CSS. 44px minimum touch targets, breakpoints at 480px and 640px. iOS zoom prevention via 16px font-size on inputs. |
| `neural.js` | Biologically realistic neural network canvas animation. Hodgkin-Huxley membrane potential model, dendrites with Bezier curves, myelinated axons, synaptic connections. Docker stats drive neuron cluster excitation. |
| `app.js` | UI logic: omnibox mode selector, WebSocket connection to `/ws` (same-origin), command execution, Docker stats rendering, recent runs tracking, exponential backoff reconnect. |

## WebSocket Protocol

All messages are JSON with a `type` field:

### Client → Server

```json
{"type": "execute", "mode": "scrape", "input": "https://example.com", "flags": {"limit": 10}}
{"type": "cancel", "id": "uuid-of-crawl-job"}
```

### Server → Client

```json
{"type": "output", "line": "{\"url\":\"...\",\"markdown\":\"...\"}"}
{"type": "done", "exit_code": 0, "elapsed_ms": 1823}
{"type": "error", "message": "exit code 1", "stderr": "...", "elapsed_ms": 400}
{"type": "stats", "container_count": 6, "containers": {...}, "aggregate": {...}}
```

## Allowed Modes

Only these command modes can be executed from the UI (whitelist in `execute.rs`):

`scrape`, `crawl`, `map`, `extract`, `search`, `research`, `embed`, `debug`, `doctor`, `query`, `retrieve`, `ask`, `evaluate`, `suggest`, `sources`, `domains`, `stats`, `status`, `dedupe`, `github`, `reddit`, `youtube`, `sessions`, `screenshot`

## Allowed Flags

Only these flags can be passed from the UI (whitelist in `execute.rs`):

| JSON Key | CLI Flag |
|----------|----------|
| `max_pages` | `--max-pages` |
| `max_depth` | `--max-depth` |
| `limit` | `--limit` |
| `collection` | `--collection` |
| `format` | `--format` |
| `render_mode` | `--render-mode` |
| `include_subdomains` | `--include-subdomains` |
| `discover_sitemaps` | `--discover-sitemaps` |
| `embed` | `--embed` |
| `diagnostics` | `--diagnostics` |

## Docker Stats

The stats poller connects to the Docker socket via `bollard::Docker::connect_with_local_defaults()` and:

1. Lists containers matching `axon-*` prefix with status `running`
2. For each container, fetches one-shot stats
3. Computes: CPU% (docker stats formula), memory (usage - cache), network I/O rates, block I/O rates
4. Broadcasts the aggregated JSON to all connected WebSocket clients every 500ms
5. The frontend maps per-container CPU to neuron cluster EPSP injection, and network I/O to extra action potential firing

## Mobile Support

The UI is fully responsive with a mobile-first design:

- **Touch targets**: All buttons are minimum 44px (Apple HIG / WCAG 2.5.5)
- **Breakpoints**: 480px (small phones), 640px (large phones/tablets)
- **iOS zoom prevention**: Input fields use 16px font-size to prevent Safari auto-zoom
- **Mode dropdown**: Switches from auto-fill grid to 2-column on mobile
- **Neural canvas**: Renders at device pixel ratio, handles resize debounce
