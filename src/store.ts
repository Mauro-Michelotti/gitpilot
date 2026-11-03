import type { ReactNode } from "react";
import { create } from "zustand";
import type {
  Account,
  AppInfo,
  FileChange,
  GraphResult,
  PullRequest,
  RepoOverview,
  Settings,
  StatusResult,
} from "./types";

export type Selection = { kind: "wip" } | { kind: "commit"; hash: string } | null;

export type DiffSource =
  | { kind: "working"; file: FileChange; staged: boolean }
  | { kind: "commit"; hash: string; file: FileChange };

export type CenterView =
  | { kind: "graph" }
  | { kind: "diff"; source: DiffSource }
  | { kind: "conflict"; file: string };

export interface RepoTab {
  path: string;
  name: string;
  overview: RepoOverview | null;
  status: StatusResult | null;
  graph: GraphResult | null;
  graphKey: string;
  graphLimit: number;
  selection: Selection;
  view: CenterView;
  loading: boolean;
  error: string | null;
  prs: PullRequest[] | null;
  prError: string | null;
  prLoading: boolean;
  /** Bumped after every refresh so open diffs/details can reload. */
  revision: number;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error" | "warning";
  text: string;
}

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  hint?: string;
}

export interface PromptField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "checkbox" | "select" | "folder" | "password";
  value?: string | boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  help?: string;
  mono?: boolean;
}

export type PromptValues = Record<string, string | boolean>;

export interface PromptSpec {
  title: string;
  message?: ReactNode;
  fields: PromptField[];
  confirmLabel?: string;
  danger?: boolean;
  resolve: (v: PromptValues | null) => void;
}

export type ModalKind = "clone" | "preferences" | null;

interface State {
  info: AppInfo | null;
  settings: Settings | null;
  accounts: Account[];
  tabs: string[];
  active: string | null;
  repos: Record<string, RepoTab>;
  toasts: Toast[];
  menu: { x: number; y: number; items: MenuItem[] } | null;
  prompt: PromptSpec | null;
  modal: ModalKind;
  busy: string | null;
  progress: string | null;
  set: (patch: Partial<State>) => void;
  patchRepo: (path: string, patch: Partial<RepoTab> | ((t: RepoTab) => Partial<RepoTab>)) => void;
}

export function emptyTab(path: string, graphLimit = 2000): RepoTab {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return {
    path,
    name,
    overview: null,
    status: null,
    graph: null,
    graphKey: "",
    graphLimit,
    selection: null,
    view: { kind: "graph" },
    loading: true,
    error: null,
    prs: null,
    prError: null,
    prLoading: false,
    revision: 0,
  };
}

export const useStore = create<State>((set) => ({
  info: null,
  settings: null,
  accounts: [],
  tabs: [],
  active: null,
  repos: {},
  toasts: [],
  menu: null,
  prompt: null,
  modal: null,
  busy: null,
  progress: null,
  set: (patch) => set(patch),
  patchRepo: (path, patch) =>
    set((s) => {
      const cur = s.repos[path];
      if (!cur) return {};
      const p = typeof patch === "function" ? patch(cur) : patch;
      return { repos: { ...s.repos, [path]: { ...cur, ...p } } };
    }),
}));

export const useActiveRepo = () => useStore((s) => (s.active ? s.repos[s.active] : undefined));
