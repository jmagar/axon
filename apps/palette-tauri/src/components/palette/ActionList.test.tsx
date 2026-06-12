// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { ActionList } from "@/components/palette/ActionList";
import { ACTIONS } from "@/lib/actions";
import { parseCommand } from "@/lib/paletteView";

HTMLElement.prototype.scrollIntoView = vi.fn();

const onSubmit = vi.fn();
const onEnterMode = vi.fn();
const onHelp = vi.fn();

function Harness() {
  const [selected, setSelected] = useState(0);
  return (
    <ActionList
      filtered={ACTIONS.slice(0, 3)}
      selected={selected}
      setSelected={setSelected}
      parsed={parseCommand("")}
      onSubmit={onSubmit}
      onEnterMode={onEnterMode}
      onHelp={onHelp}
    />
  );
}

it("opens selected-row help without submitting or entering action mode", () => {
  onSubmit.mockClear();
  onEnterMode.mockClear();
  onHelp.mockClear();
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Help for Help" }));
  expect(onHelp).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onEnterMode).not.toHaveBeenCalled();
});
