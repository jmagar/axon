// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { invoke } from "./lib/invoke";

vi.mock("./lib/invoke", async () => {
  const actual = await vi.importActual<typeof import("./lib/invoke")>("./lib/invoke");
  return {
    ...actual,
    invoke: vi.fn(),
  };
});

const config = {
  serverUrl: "http://127.0.0.1:9999",
  token: null,
  shortcut: "Ctrl+Space",
  collection: "axon",
  resultLimit: 10,
  theme: "dark",
  hideOnBlur: false,
  openResultsInline: true,
  envValues: {},
  configValues: {},
};

describe("App local help", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "load_palette_config" || command === "load_palette_default_config") return config;
      if (command === "resize_palette" || command === "hide_palette") return undefined;
      if (command === "axon_http_request") throw new Error("REST should not be called for local help");
      return undefined;
    });
  });

  it("opens selected action help from the command bar and replays it from history as local help", async () => {
    render(<App />);

    const input = await screen.findByLabelText("Axon command");
    fireEvent.change(input, { target: { value: "scrape" } });
    const commandHelp = (await screen.findAllByLabelText("Help for Scrape URL")).find((button) =>
      button.classList.contains("command-help"),
    );
    expect(commandHelp).toBeDefined();
    fireEvent.click(commandHelp!);

    expect(await screen.findByText("Scrape URL")).toBeTruthy();
    expect(screen.getByText("POST /v1/scrape")).toBeTruthy();
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("axon_http_request", expect.anything());

    fireEvent.click(screen.getByText("↺ recent"));
    const historyRow = (await screen.findAllByRole("button")).find((button) => button.classList.contains("history-row"));
    expect(historyRow).toBeDefined();
    fireEvent.click(historyRow!);

    await waitFor(() => expect(screen.getByText("POST /v1/scrape")).toBeTruthy());
    expect(screen.getByText("Scrape URL")).toBeTruthy();
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("axon_http_request", expect.anything());
  });
});
