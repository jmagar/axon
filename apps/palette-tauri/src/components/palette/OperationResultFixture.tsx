// Visual + smoke-test harness for the result-rendering layer. Each entry in `cases`
// is a (title, action, run) triple fed straight into <OutputPanel>, so every
// structured view (scrape reader, search/research, doctor, screenshot, job-start,
// error views, …) can be eyeballed side-by-side in one screen and asserted against
// in OperationResultView.test.tsx (T-M2). It mounts the real OutputPanel with noop
// callbacks — no backend, no async — so it doubles as a deterministic fixture for
// render/sanitization tests.
//
// To add a case: pick the `subcommand` of the action you want to exercise (it must
// exist in `ACTIONS`), then push a new `{ title, action: actionFor("<subcommand>"),
// run }` object. The `run` is a terminal RunState (kind "success" or "error") whose
// `result.payload` should mirror the real Axon response shape for that subcommand —
// copy a real payload and trim it. Set `outputKind` to "markdown" or "code" to match
// what `outputKindFor(subcommand)` returns. Keep payloads small but representative
// (include the edge cases you care about: empty arrays, long strings, missing fields).
import { OutputPanel } from "@/components/palette/OutputPanel";
import { ACTIONS, type PaletteAction } from "@/lib/actions";
import { buildHelpRun } from "@/lib/actionHelp";
import type { RunState } from "@/lib/runState";

const noop = () => {};
type FixtureRunState = Extract<RunState, { result: unknown }>;

export const OPERATION_RESULT_FIXTURE_CASES: Array<{
  title: string;
  action: PaletteAction;
  run: FixtureRunState;
}> = [
    {
      title: "Structured Error",
      action: actionFor("crawl-status"),
      run: {
        kind: "error",
        title: "Job status failed",
        subtitle: "crawl-status not-a-uuid",
        text: "id must be a UUID",
        outputKind: "code",
        result: {
          ok: false,
          status: 0,
          method: "GET",
          path: "/v1/crawl/not-a-uuid",
          payload: { kind: "missing_param", message: "id must be a UUID", param: "job_id" },
        },
      },
    },
    {
      title: "Help Detail",
      action: actionFor("help"),
      run: buildHelpRun(actionFor("scrape")),
    },
    {
      title: "Scrape Reader",
      action: actionFor("scrape"),
      run: {
        kind: "success",
        title: "Scrape completed",
        subtitle: "https://docs.rs/serde",
        text: "# Serde\n\nSerde is a framework for serializing and deserializing Rust data structures efficiently and generically.",
        outputKind: "markdown",
        result: {
          ok: true,
          status: 200,
          method: "POST",
          path: "/v1/scrape",
          payload: {
            url: "https://docs.rs/serde",
            title: "Serde docs",
            markdown:
              '# Serde\n\nSerde is a framework for serializing and deserializing Rust data structures efficiently and generically.\n\n- Derive support\n- JSON and other formats\n- Zero-copy options\n-\n-\n\n```rust\n#[derive(Debug, Serialize, Deserialize)]\npub struct User {\n    id: u64,\n    name: String,\n}\n\nimpl User {\n    pub fn label(&self) -> String {\n        format!("user:{}:{}", self.id, self.name)\n    }\n}\n```\n\n```txt\n-\n```',
          },
        },
      },
    },
    {
      title: "Map URLs",
      action: actionFor("map"),
      run: successRun("Map completed", "https://example.com", "code", "/v1/map", {
        urls: ["https://example.com/docs", "https://example.com/docs/api"],
        count: 2,
      }),
    },
    {
      title: "Retrieve Empty",
      action: actionFor("retrieve"),
      run: {
        kind: "success",
        title: "Retrieve completed",
        subtitle: "https://example.com/missing",
        text: "{}",
        outputKind: "code",
        result: {
          ok: true,
          status: 200,
          method: "POST",
          path: "/v1/retrieve",
          payload: { url: "https://example.com/missing", chunks: [] },
        },
      },
    },
    {
      title: "Suggested URLs",
      action: actionFor("suggest"),
      run: successRun("Suggest completed", "palette", "markdown", "/v1/suggest", {
        suggestions: [
          { title: "Tauri docs", url: "https://tauri.app/start/", reason: "Desktop shell reference." },
          { title: "React docs", url: "https://react.dev/reference/react", reason: "Component model reference." },
        ],
      }),
    },
    {
      title: "Sources List",
      action: actionFor("sources"),
      run: successRun("Sources completed", "collection axon", "code", "/v1/sources", {
        urls: ["https://github.com/jmagar/axon", "https://docs.rs/tauri"],
      }),
    },
    {
      title: "Domains List",
      action: actionFor("domains"),
      run: successRun("Domains completed", "collection axon", "code", "/v1/domains", {
        domains: [{ domain: "github.com", count: 128 }, { domain: "docs.rs", count: 42 }],
      }),
    },
    {
      title: "Search Results",
      action: actionFor("search"),
      run: {
        kind: "success",
        title: "Search completed",
        subtitle: "rust qdrant hybrid search",
        text: "3 results",
        outputKind: "markdown",
        result: {
          ok: true,
          status: 200,
          method: "POST",
          path: "/v1/search",
          payload: {
            results: [
              {
                title: "Qdrant hybrid search",
                url: "https://qdrant.tech/documentation/concepts/hybrid-queries/",
                snippet: "Hybrid queries combine sparse and dense vectors with reciprocal rank fusion.",
                rank: 1,
              },
              {
                title: "Rust async traits",
                url: "https://doc.rust-lang.org/book/",
                snippet: "Patterns for async runtimes, typed service layers, and predictable error handling.",
                rank: 2,
              },
            ],
            crawl_jobs: [{ id: "018f3d8a-64b0-7c51-9a84-f3a39b5a5f18", status: "queued", url: "https://qdrant.tech/documentation/" }],
          },
        },
      },
    },
    {
      title: "Research Summary",
      action: actionFor("research"),
      run: {
        kind: "success",
        title: "Research completed",
        subtitle: "how can you programmatically pull claude code session id",
        text: "summary",
        outputKind: "markdown",
        result: {
          ok: true,
          status: 200,
          method: "POST",
          path: "/v1/research",
          payload: {
            summary: [
              "The reliable path is to start Claude in non-interactive mode and read `session_id` from JSON output.",
              "",
              "Example pattern from the docs:",
              "",
              "```bash",
              "session_id=$(claude -p \"Start a review\" --output-format json | jq -r '.session_id')",
              "claude -p \"Continue that review\" --resume \"$session_id\"",
              "```",
              "",
              "For streamed events, extract the same `session_id` from `stream-json` metadata.",
              "",
              "```bash",
              "claude -p \"...\" --output-format stream-json",
              "```",
            ].join("\n"),
            results: [
              {
                title: "Claude Code SDK",
                url: "https://docs.anthropic.com/en/docs/claude-code/sdk",
                snippet: "Structured output includes session metadata.",
                rank: 1,
              },
            ],
            crawl_jobs: [{ id: "018f3d8a-64b0-7c51-9a84-f3a39b5a5f18", status: "queued", url: "https://docs.anthropic.com/" }],
          },
        },
      },
    },
    {
      title: "Crawl Job",
      action: actionFor("crawl"),
      run: jobRun("crawl", "crawl-job-1234567890"),
    },
    {
      title: "Embed Job",
      action: actionFor("embed"),
      run: jobRun("embed", "embed-job-1234567890"),
    },
    {
      title: "Extract Job",
      action: actionFor("extract"),
      run: jobRun("extract", "extract-job-1234567890"),
    },
    {
      title: "Ingest Job",
      action: actionFor("ingest"),
      run: jobRun("ingest", "ingest-job-1234567890"),
    },
    {
      title: "Prepared Sessions Job",
      action: actionFor("ingest-sessions-prepared"),
      run: jobRun("ingest-sessions-prepared", "sessions-job-1234567890", "ingest"),
    },
    {
      title: "Query Matches",
      action: actionFor("query"),
      run: {
        kind: "success",
        title: "Query completed",
        subtitle: "collection axon",
        text: "2 matches",
        outputKind: "markdown",
        result: {
          ok: true,
          status: 200,
          method: "POST",
          path: "/v1/query",
          payload: {
            collection: "axon",
            results: [
              {
                title: "src/vector/ops/qdrant/search.rs",
                url: "file:///home/jmagar/workspace/axon/src/vector/ops/qdrant/search.rs",
                content: "RRF merges dense and sparse matches while preserving payload metadata.",
                score: 0.9124,
                rank: 1,
              },
              {
                title: "docs/reference/vector.md",
                url: "file:///home/jmagar/workspace/axon/docs/reference/vector.md",
                content: "Named dense vectors and BM42 sparse vectors are queried together when available.",
                score: 0.8731,
                rank: 2,
              },
            ],
          },
        },
      },
    },
    {
      title: "Endpoint Discovery",
      action: actionFor("endpoints"),
      run: successRun("Endpoints completed", "https://example.com/app", "markdown", "/v1/endpoints", {
        total: 2,
        endpoints: ["https://example.com/api/search", "https://example.com/rpc"],
      }),
    },
    {
      title: "Brand Identity",
      action: actionFor("brand"),
      run: successRun("Brand completed", "https://aurora.tootie.tv", "markdown", "/v1/brand", {
        name: "Aurora",
        colors: [{ hex: "#29b6f6", usage: "primary" }, { hex: "#f9a8c4", usage: "secondary" }],
        fonts: ["Manrope", "JetBrains Mono"],
      }),
    },
    {
      title: "URL Diff",
      action: actionFor("diff"),
      run: successRun("Diff completed", "two URLs", "markdown", "/v1/diff", {
        status: "changed",
        url_a: "https://example.com/a",
        url_b: "https://example.com/b",
        word_count_delta: 18,
        metadata_changes: [{ field: "title", old: "Old docs", new: "New docs" }],
      }),
    },
    {
      title: "Doctor Degraded",
      action: actionFor("doctor"),
      run: {
        kind: "success",
        title: "Doctor completed",
        subtitle: "Qdrant, TEI, Chrome",
        text: "degraded",
        outputKind: "markdown",
        result: {
          ok: true,
          status: 200,
          method: "GET",
          path: "/v1/doctor",
          payload: {
            degraded: true,
            checks: [
              { name: "Qdrant", status: "ok", message: "Collection axon is reachable." },
              { name: "TEI", status: "warn", message: "Embedding endpoint answered slowly, retry budget still available." },
              { name: "Chrome", status: "ok", message: "CDP management endpoint is healthy." },
            ],
          },
        },
      },
    },
    {
      title: "Dedupe Report",
      action: actionFor("dedupe"),
      run: successRun("Dedupe completed", "collection axon", "code", "/v1/dedupe", {
        collection: "axon",
        scanned: 100,
        removed: 4,
      }),
    },
    {
      title: "Screenshot Preview",
      action: actionFor("screenshot"),
      run: {
        kind: "success",
        title: "Screenshot completed",
        subtitle: "https://aurora.tootie.tv",
        text: "screenshot captured",
        outputKind: "markdown",
        result: {
          ok: true,
          status: 200,
          method: "POST",
          path: "/v1/screenshot",
          payload: {
            url: "https://aurora.tootie.tv",
            path: "/tmp/axon-aurora-screenshot.png",
            preview_url: previewImage(),
            size_bytes: 48211,
          },
        },
      },
    },
    {
      title: "Watch Created",
      action: actionFor("watch-create"),
      run: successRun(
        "Watch created",
        "https://example.com/docs",
        "code",
        "/v1/watch",
        {
          name: "example.com",
          watch_id: "watch-1",
          every_seconds: 3600,
          enabled: true,
        },
        "POST",
      ),
    },
    {
      title: "Watch Run",
      action: actionFor("watch-run"),
      run: successRun("Watch run completed", "watch-1", "code", "/v1/watch/watch-1/run", {
        name: "Docs watch",
        watch_id: "watch-1",
        artifacts: [{ id: "artifact-1", kind: "url-change" }],
      }),
    },
    {
      title: "Watch Empty",
      action: actionFor("watch-list"),
      run: {
        kind: "success",
        title: "Watch list completed",
        subtitle: "scheduled operations",
        text: "[]",
        outputKind: "code",
        result: {
          ok: true,
          status: 200,
          method: "GET",
          path: "/v1/watch",
          payload: { watches: [] },
        },
      },
    },
  ];

export function OperationResultFixture() {
  const cases = OPERATION_RESULT_FIXTURE_CASES;
  return (
    <main className="operation-fixture">
      <header className="operation-fixture-header">
        <span>Axon Palette</span>
        <h1>Operation Response Fixture</h1>
      </header>
      <div className="operation-fixture-grid">
        {cases.map((item) => (
          <section key={item.title} className="operation-fixture-case">
            <h2>{item.title}</h2>
            <OutputPanel
              active={item.action}
              copied={false}
              outputKind={item.run.outputKind}
              run={item.run}
              onCopy={noop}
              onRetry={noop}
              onFollowUp={noop}
              onHistory={noop}
              onCollapse={noop}
              onTogglePin={noop}
              pinned={false}
            />
          </section>
        ))}
      </div>
    </main>
  );
}

function actionFor(subcommand: string): PaletteAction {
  const action = ACTIONS.find((item) => item.subcommand === subcommand);
  if (!action) throw new Error(`missing fixture action: ${subcommand}`);
  return action;
}

function successRun(
  title: string,
  subtitle: string,
  outputKind: "markdown" | "code",
  path: string,
  payload: Record<string, unknown>,
  method: "GET" | "POST" | "DELETE" = path.includes("/v1/sources") || path.includes("/v1/domains") || path === "/v1/watch" ? "GET" : "POST",
): FixtureRunState {
  return {
    kind: "success",
    title,
    subtitle,
    text: JSON.stringify(payload, null, 2),
    outputKind,
    result: {
      ok: true,
      status: 200,
      method,
      path,
      payload,
    },
  };
}

function jobRun(
  subcommand: string,
  jobId: string,
  family = subcommand,
): FixtureRunState {
  return successRun(`${family} job queued`, jobId, "code", `/v1/${family}`, {
    execution_mode: "async",
    result: { job_id: jobId, status: "queued" },
    status_url: `/v1/${family}/${jobId}`,
  });
}

function previewImage(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#07131c"/><rect x="72" y="72" width="816" height="96" rx="18" fill="#0f2635" stroke="#1d3d4e"/><rect x="72" y="208" width="384" height="220" rx="18" fill="#102b3d" stroke="#1d3d4e"/><rect x="504" y="208" width="384" height="220" rx="18" fill="#1a2144" stroke="#3b3270"/><circle cx="124" cy="120" r="22" fill="#29b6f6"/><rect x="172" y="103" width="280" height="18" rx="9" fill="#e6f4fb"/><rect x="172" y="132" width="460" height="12" rx="6" fill="#a7bcc9"/><rect x="112" y="254" width="264" height="18" rx="9" fill="#67cbfa"/><rect x="112" y="294" width="300" height="12" rx="6" fill="#a7bcc9"/><rect x="112" y="324" width="236" height="12" rx="6" fill="#a7bcc9"/><rect x="544" y="254" width="220" height="18" rx="9" fill="#f9a8c4"/><rect x="544" y="294" width="284" height="12" rx="6" fill="#a7bcc9"/><rect x="544" y="324" width="244" height="12" rx="6" fill="#a7bcc9"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
