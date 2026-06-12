// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { HistoryItem } from "@/components/palette/HistoryPanel";
import { ACTIONS, type PaletteAction } from "@/lib/actions";
import type { Client, PaletteConfig } from "@/lib/axonClient";
import { parseCommand } from "@/lib/paletteView";
import type { RunState } from "@/lib/runState";
import { useActionRunner } from "@/lib/useActionRunner";

function action(subcommand: string) {
  const found = ACTIONS.find((candidate) => candidate.subcommand === subcommand);
  if (!found) throw new Error(`missing action ${subcommand}`);
  return found;
}

const config: PaletteConfig = {
  serverUrl: "http://127.0.0.1:9999",
  token: null,
  shortcut: "Ctrl+Space",
  collection: "axon",
  resultLimit: 10,
  theme: "dark",
  hideOnBlur: false,
};

const client: Client = { baseUrl: "http://127.0.0.1:9999", headers: {} };

function setup(query: string, overrides: { client?: Client | null; config?: PaletteConfig | null } = {}) {
  const parsed = parseCommand(query);
  return renderHook(() => {
    const [run, setRun] = useState<RunState>({ kind: "idle" });
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [modeAction, setModeAction] = useState<PaletteAction | null>(null);
    const [input, setQuery] = useState(query);
    const [, setBrowseOpen] = useState(false);
    const runner = useActionRunner({
      client: overrides.client === undefined ? client : overrides.client,
      config: overrides.config === undefined ? config : overrides.config,
      run,
      setRun,
      setHistory,
      setModeAction,
      setQuery,
      setBrowseOpen,
      modeAction,
      parsed,
      query: input,
    });
    return { ...runner, run, history, parsed };
  });
}

describe("useActionRunner local help", () => {
  it.each([
    ["help", "help"],
    ["help scrape", "help"],
    ["scrape help", "help"],
    ["fetch help", "help"],
    ["crawl --help", "help"],
    ["?", "help"],
  ])("handles %s without requiring a backend client", async (query, subcommand) => {
    const rendered = setup(query, { client: null, config: null });
    await act(async () => {
      await rendered.result.current.submit(action(subcommand));
    });
    expect(rendered.result.current.run.kind).toBe("success");
    expect("result" in rendered.result.current.run ? rendered.result.current.run.result.path : "").toBe("palette://help");
  });
});
