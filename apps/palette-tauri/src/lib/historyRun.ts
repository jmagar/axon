import type { HistoryItem } from "@/components/palette/HistoryPanel";
import { outputKindFor } from "@/lib/format";
import type { RunState } from "@/lib/runState";

export function runStateFromHistory(item: HistoryItem): RunState | null {
  if (item.text == null) return null;
  const ok = item.status >= 200 && item.status < 300;
  return {
    kind: ok ? "success" : "error",
    title: `${item.action.label} ${ok ? "completed" : "failed"}`,
    subtitle: item.target,
    text: item.text,
    outputKind: item.outputKind ?? outputKindFor(item.action.subcommand),
    result: {
      ok,
      status: item.status,
      path: item.action.kind === "local" ? `palette://${item.action.subcommand}` : item.action.subcommand,
      method: item.action.kind === "local" ? "GET" : "POST",
      payload: item.payload ?? null,
    },
  };
}
