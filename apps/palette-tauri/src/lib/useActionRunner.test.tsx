// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => vi.restoreAllMocks());

function setup(
  query: string,
  overrides: { client?: Client | null; config?: PaletteConfig | null; modeAction?: PaletteAction | null } = {},
) {
  const parsed = parseCommand(query);
  return renderHook(() => {
    const [run, setRun] = useState<RunState>({ kind: "idle" });
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [modeAction, setModeAction] = useState<PaletteAction | null>(overrides.modeAction ?? null);
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
    ["help", "help", undefined],
    ["help scrape", "help", "scrape"],
    ["scrape help", "help", "scrape"],
    ["fetch help", "help", "scrape"],
    ["crawl --help", "help", "crawl"],
    ["?", "help", undefined],
  ])("handles %s without requiring a backend client", async (query, subcommand, target) => {
    const rendered = setup(query, { client: null, config: null });
    await act(async () => {
      await rendered.result.current.submit(action(subcommand));
    });
    expect(rendered.result.current.run.kind).toBe("success");
    expect("result" in rendered.result.current.run ? rendered.result.current.run.result.path : "").toBe("palette://help");
    const payload = "result" in rendered.result.current.run ? rendered.result.current.run.result.payload : null;
    if (target) expect(payload).toMatchObject({ target: { subcommand: target } });
    else expect(payload).toMatchObject({ catalog: expect.any(Array) });
  });

  it.each([
    ["help", "help"],
    ["help scrape", "help"],
    ["scrape help", "help"],
    ["crawl --help", "help"],
  ])("does not call REST for %s when a backend client exists", async (query, subcommand) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("REST should not be called"));
    const rendered = setup(query);
    await act(async () => {
      await rendered.result.current.submit(action(subcommand));
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes mode-local help through the Help action while targeting the current mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("REST should not be called"));
    const rendered = setup("?", { modeAction: action("scrape") });
    await act(async () => {
      await rendered.result.current.submit(action("scrape"));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rendered.result.current.history[0]?.action.subcommand).toBe("help");
    expect(rendered.result.current.history[0]?.target).toBe("scrape");
    expect(rendered.result.current.run.kind).toBe("success");
    expect("result" in rendered.result.current.run ? rendered.result.current.run.result.path : "").toBe("palette://help");
    expect("result" in rendered.result.current.run ? rendered.result.current.run.result.payload : null).toMatchObject({
      target: { subcommand: "scrape" },
    });
  });
});
