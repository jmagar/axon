import type { PaletteAction } from "@/lib/actions";
import type { HttpMethod } from "@/lib/axonClient";

export type ActionDisplayMeta = {
  category: string;
  endpoint: string;
  input: string;
  output: string;
  label: string;
  method: HttpMethod;
};

const ACTION_META: Record<string, ActionDisplayMeta> = {
  help: { category: "System", endpoint: "palette://help", input: "action", output: "help", label: "Help", method: "GET" },
  scrape: { category: "Fetch & read", endpoint: "/v1/scrape", input: "one URL", output: "content", label: "Scrape", method: "POST" },
  map: { category: "Fetch & read", endpoint: "/v1/map", input: "one URL", output: "links", label: "Map", method: "POST" },
  retrieve: { category: "Fetch & read", endpoint: "/v1/retrieve", input: "URL", output: "chunks", label: "Retrieve", method: "POST" },
  screenshot: { category: "Fetch & read", endpoint: "/v1/screenshot", input: "URL", output: "PNG", label: "Screenshot", method: "POST" },
  diff: { category: "Fetch & read", endpoint: "/v1/diff", input: "two URLs", output: "changes", label: "Diff", method: "POST" },
  crawl: { category: "Crawl & ingest", endpoint: "/v1/crawl", input: "start URL", output: "job", label: "Crawl", method: "POST" },
  ingest: { category: "Crawl & ingest", endpoint: "/v1/ingest", input: "target", output: "job", label: "Ingest", method: "POST" },
  embed: { category: "Crawl & ingest", endpoint: "/v1/embed", input: "input", output: "vectors", label: "Embed", method: "POST" },
  extract: { category: "Crawl & ingest", endpoint: "/v1/extract", input: "URLs", output: "data", label: "Extract", method: "POST" },
  "ingest-sessions-prepared": { category: "Crawl & ingest", endpoint: "/v1/ingest/sessions/prepared", input: "JSON", output: "job", label: "Prepared sessions", method: "POST" },
  search: { category: "Search & discover", endpoint: "/v1/search", input: "query", output: "results", label: "Search", method: "POST" },
  research: { category: "Search & discover", endpoint: "/v1/research", input: "query", output: "brief", label: "Research", method: "POST" },
  query: { category: "Search & discover", endpoint: "/v1/query", input: "query", output: "chunks", label: "Query", method: "POST" },
  sources: { category: "Search & discover", endpoint: "/v1/sources", input: "none", output: "URLs", label: "Sources", method: "GET" },
  domains: { category: "Search & discover", endpoint: "/v1/domains", input: "none", output: "domains", label: "Domains", method: "GET" },
  ask: { category: "Reason", endpoint: "/v1/ask", input: "question", output: "answer", label: "Ask", method: "POST" },
  chat: { category: "Reason", endpoint: "/v1/chat", input: "message", output: "answer", label: "Chat", method: "POST" },
  summarize: { category: "Reason", endpoint: "/v1/summarize", input: "URLs", output: "summary", label: "Summarize", method: "POST" },
  suggest: { category: "Reason", endpoint: "/v1/suggest", input: "focus", output: "URLs", label: "Suggest", method: "POST" },
  evaluate: { category: "Reason", endpoint: "/v1/evaluate", input: "question", output: "score", label: "Evaluate", method: "POST" },
  status: { category: "System", endpoint: "/v1/status", input: "none", output: "jobs", label: "Status", method: "GET" },
  stats: { category: "System", endpoint: "/v1/stats", input: "none", output: "stats", label: "Stats", method: "GET" },
  doctor: { category: "System", endpoint: "/v1/doctor", input: "none", output: "health", label: "Doctor", method: "GET" },
  endpoints: { category: "Inspect", endpoint: "/v1/endpoints", input: "URL", output: "endpoints", label: "Endpoints", method: "POST" },
  brand: { category: "Inspect", endpoint: "/v1/brand", input: "URL", output: "brand", label: "Brand", method: "POST" },
  dedupe: { category: "System", endpoint: "/v1/dedupe", input: "collection", output: "report", label: "Dedupe", method: "POST" },
  "watch-list": { category: "Watch", endpoint: "/v1/watch", input: "none", output: "watches", label: "Watch list", method: "GET" },
  "watch-create": { category: "Watch", endpoint: "/v1/watch", input: "URL", output: "watch", label: "Watch create", method: "POST" },
  "watch-run": { category: "Watch", endpoint: "/v1/watch/{id}/run", input: "watch id", output: "run", label: "Watch run", method: "POST" },
};

export function actionDisplayMeta(action: PaletteAction): ActionDisplayMeta {
  const lifecycle = lifecycleDisplayMeta(action);
  return (
    ACTION_META[action.subcommand] ??
    lifecycle ?? {
      category: action.kind === "local" ? "System" : "Other",
      endpoint: action.kind === "local" ? `palette://${action.subcommand}` : `/v1/${action.subcommand}`,
      input: action.argMode === "none" ? "none" : "input",
      output: action.kind === "local" ? "local" : "result",
      label: action.label,
      method: action.kind === "local" ? "GET" : "POST",
    }
  );
}

export function actionKindLabel(action: PaletteAction): string {
  switch (action.kind) {
    case "admin":
      return "Admin";
    case "discovery":
      return "Discovery";
    case "job":
      return "Job";
    case "local":
      return "Local";
    case "operation":
    default:
      return "Operation";
  }
}

export function actionKindTone(action: PaletteAction): "info" | "success" | "warn" | "neutral" | "rose" | "violet" {
  switch (action.kind) {
    case "admin":
      return "warn";
    case "discovery":
      return "neutral";
    case "job":
      return "violet";
    case "local":
      return "info";
    case "operation":
    default:
      return "info";
  }
}

function lifecycleDisplayMeta(action: PaletteAction): ActionDisplayMeta | undefined {
  const match = /^(crawl|embed|extract|ingest)-(list|status|cancel|cleanup|clear|recover)$/.exec(action.subcommand);
  if (!match) return undefined;
  const [, family, operation] = match;
  const input = ["list", "cleanup", "clear", "recover"].includes(operation) ? "none" : "job id";
  const method = operation === "list" || operation === "status" ? "GET" : operation === "clear" ? "DELETE" : "POST";
  const endpoint =
    operation === "list" ? `/v1/${family}`
    : operation === "status" ? `/v1/${family}/{id}`
    : operation === "cancel" ? `/v1/${family}/{id}/cancel`
    : operation === "clear" ? `/v1/${family}`
    : `/v1/${family}/${operation}`;
  return {
    category: "Jobs",
    endpoint,
    input,
    output: "job",
    label: action.label,
    method,
  };
}
