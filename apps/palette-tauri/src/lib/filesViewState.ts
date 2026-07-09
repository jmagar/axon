// useReducer-based state model for FilesView.tsx. Centralizing all Files-view
// state transitions here (rather than a flat useState block in the
// component) keeps FilesView.tsx a thin renderer over `state`/`dispatch` as
// later tasks add split-pane, bulk-select, AI-edit, and SFTP state — each
// adds new `FilesViewAction` members and reducer cases here instead of new
// `useState` calls and prop-drilled setters in the component.

import type { AiEditProposal } from "./aiEditModel";
import {
  type CheckedPaths,
  checkAllIn,
  clearChecked,
  createPane,
  type DirListing,
  type FileContents,
  type FileEntry,
  type FilesPane,
  isChecked,
  type LoadState,
  type PaneId,
  toggleChecked,
} from "./filesModel";

export const MIN_TREE_WIDTH = 180;
export const MAX_TREE_WIDTH = 460;
const DEFAULT_TREE_WIDTH = 248;

export interface FilesViewState {
  panes: [FilesPane] | [FilesPane, FilesPane];
  activePane: PaneId;
  listings: Record<PaneId, LoadState<DirListing>>;
  treeWidth: number;
  checked: CheckedPaths;
}

export function createInitialState(): FilesViewState {
  return {
    panes: [createPane("left")],
    activePane: "left",
    listings: { left: { kind: "idle" }, right: { kind: "idle" } },
    treeWidth: DEFAULT_TREE_WIDTH,
    checked: clearChecked(),
  };
}

export type FilesViewAction =
  | { type: "pane/setCwd"; pane: PaneId; cwd: string }
  | { type: "pane/listingLoading"; pane: PaneId }
  | { type: "pane/listingLoaded"; pane: PaneId; listing: DirListing }
  | { type: "pane/listingError"; pane: PaneId; message: string }
  | { type: "pane/select"; pane: PaneId; entry: FileEntry | null }
  | { type: "pane/fileLoading"; pane: PaneId; loadGen: number }
  | { type: "pane/fileLoaded"; pane: PaneId; loadGen: number; file: FileContents }
  | { type: "pane/fileError"; pane: PaneId; loadGen: number; message: string }
  | { type: "pane/setEditing"; pane: PaneId; editing: boolean }
  | { type: "pane/setDraft"; pane: PaneId; draft: string }
  | { type: "pane/setSaving"; pane: PaneId; saving: boolean }
  | { type: "split/open" }
  | { type: "split/close" }
  | { type: "pane/setActive"; pane: PaneId }
  | { type: "treeWidth/set"; width: number }
  | { type: "checked/toggle"; path: string }
  | { type: "checked/checkAll"; paths: string[] }
  | { type: "checked/clear" }
  | { type: "pane/sparkleOpen"; pane: PaneId }
  | { type: "pane/sparkleClose"; pane: PaneId }
  | { type: "pane/sparkleQueryChange"; pane: PaneId; query: string }
  | { type: "pane/proposalPending"; pane: PaneId }
  | { type: "pane/proposalReady"; pane: PaneId; proposal: AiEditProposal }
  | { type: "pane/proposalError"; pane: PaneId; message: string }
  | { type: "pane/proposalDeny"; pane: PaneId }
  | { type: "pane/proposalApproveStart"; pane: PaneId }
  | { type: "pane/proposalApproved"; pane: PaneId; file: FileContents }
  | { type: "pane/proposalApproveError"; pane: PaneId; message: string };

function updatePane(
  panes: FilesViewState["panes"],
  id: PaneId,
  patch: Partial<FilesPane>,
): FilesViewState["panes"] {
  const mapped = panes.map((pane) => (pane.id === id ? { ...pane, ...patch } : pane));
  return mapped as FilesViewState["panes"];
}

function findPane(panes: FilesViewState["panes"], id: PaneId): FilesPane | undefined {
  return panes.find((pane) => pane.id === id);
}

export function filesViewReducer(state: FilesViewState, action: FilesViewAction): FilesViewState {
  switch (action.type) {
    case "pane/setCwd":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          cwd: action.cwd,
          selected: null,
          file: { kind: "idle" },
        }),
      };
    case "pane/listingLoading":
      return { ...state, listings: { ...state.listings, [action.pane]: { kind: "loading" } } };
    case "pane/listingLoaded":
      return {
        ...state,
        listings: { ...state.listings, [action.pane]: { kind: "loaded", value: action.listing } },
      };
    case "pane/listingError":
      return {
        ...state,
        listings: {
          ...state.listings,
          [action.pane]: { kind: "error", message: action.message },
        },
      };
    case "pane/select":
      return { ...state, panes: updatePane(state.panes, action.pane, { selected: action.entry }) };
    case "pane/fileLoading":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          file: { kind: "loading" },
          loadGen: action.loadGen,
          editing: false,
        }),
      };
    case "pane/fileLoaded": {
      const pane = findPane(state.panes, action.pane);
      // Drop stale resolutions: only apply if this is still the pane's
      // current in-flight generation. A superseded (older) loadGen means a
      // newer loadDir/loadFile dispatch has already started — applying this
      // result would overwrite the newer request's eventual outcome.
      if (!pane || pane.loadGen !== action.loadGen) return state;
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          file: { kind: "loaded", value: action.file },
          draft: action.file.content,
        }),
      };
    }
    case "pane/fileError": {
      const pane = findPane(state.panes, action.pane);
      if (!pane || pane.loadGen !== action.loadGen) return state;
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          file: { kind: "error", message: action.message },
        }),
      };
    }
    case "pane/setEditing":
      return { ...state, panes: updatePane(state.panes, action.pane, { editing: action.editing }) };
    case "pane/setDraft":
      return { ...state, panes: updatePane(state.panes, action.pane, { draft: action.draft }) };
    case "pane/setSaving":
      return { ...state, panes: updatePane(state.panes, action.pane, { saving: action.saving }) };
    case "split/open": {
      if (state.panes.length === 2) return state;
      const left = state.panes[0];
      return { ...state, panes: [left, createPane("right", left.cwd)] };
    }
    case "split/close":
      return { ...state, panes: [state.panes[0]], activePane: "left" };
    case "pane/setActive":
      if (state.panes.length < 2) return state;
      return { ...state, activePane: action.pane };
    case "treeWidth/set":
      return {
        ...state,
        treeWidth: Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, action.width)),
      };
    case "checked/toggle":
      return { ...state, checked: toggleChecked(state.checked, action.path) };
    case "checked/checkAll":
      return { ...state, checked: checkAllIn(state.checked, action.paths) };
    case "checked/clear":
      return { ...state, checked: clearChecked() };
    case "pane/sparkleOpen":
      return { ...state, panes: updatePane(state.panes, action.pane, { sparkleOpen: true }) };
    case "pane/sparkleClose":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, { sparkleOpen: false, sparkleQuery: "" }),
      };
    case "pane/sparkleQueryChange":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, { sparkleQuery: action.query }),
      };
    case "pane/proposalPending":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          proposalState: "pending",
          proposalErrorMessage: null,
        }),
      };
    case "pane/proposalReady":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          proposal: action.proposal,
          proposalState: "ready",
          proposalErrorMessage: null,
          sparkleOpen: false,
          sparkleQuery: "",
        }),
      };
    case "pane/proposalError":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          proposalState: "error",
          proposalErrorMessage: action.message,
        }),
      };
    case "pane/proposalDeny":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          proposal: null,
          proposalState: "idle",
          proposalErrorMessage: null,
        }),
      };
    case "pane/proposalApproveStart":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          proposalState: "approving",
          proposalErrorMessage: null,
        }),
      };
    case "pane/proposalApproved":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          file: { kind: "loaded", value: action.file },
          draft: action.file.content,
          proposal: null,
          proposalState: "idle",
          proposalErrorMessage: null,
        }),
      };
    case "pane/proposalApproveError":
      return {
        ...state,
        panes: updatePane(state.panes, action.pane, {
          proposalState: "error",
          proposalErrorMessage: action.message,
        }),
      };
    default:
      return state;
  }
}

export { isChecked };
