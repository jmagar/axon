import { Badge } from "@/components/ui/aurora/badge";
import { ScrollArea } from "@/components/ui/aurora/scroll-area";
import type { PaletteAction } from "@/lib/actions";
import {
  actionArgumentLabel,
  actionHint,
  actionKindLabel,
} from "@/lib/paletteView";

interface ActionPanelProps {
  actions: PaletteAction[];
  selected: number;
  validation: string | null;
  search: string;
  onSelect: (action: PaletteAction, index: number) => void;
}

export function ActionPanel({
  actions,
  selected,
  validation,
  search,
  onSelect,
}: ActionPanelProps) {
  return (
    <section className="action-panel">
      <div className="panel-heading">
        <span>Actions</span>
        <span>{validation || `${actions.length} matches`}</span>
      </div>
      <ScrollArea className="action-scroll" viewportClassName="action-scroll-viewport">
        <div className="action-list">
          {actions.map((action, index) => (
            <button
              key={action.subcommand}
              className={index === selected ? "action-row action-row-selected" : "action-row"}
              onClick={() => onSelect(action, index)}
            >
              <span className="action-main">
                <span className="action-title-line">
                  <span className="action-label">{action.label}</span>
                  <span className="action-kind">{actionKindLabel(action)}</span>
                </span>
                <span className="action-description">{action.description}</span>
              </span>
              <span className="action-meta">
                <span className="action-input-mode">{actionArgumentLabel(action)}</span>
                <kbd>{actionHint(action, search)}</kbd>
                <Badge tone={action.tone} shape="tag">
                  {action.subcommand}
                </Badge>
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}
