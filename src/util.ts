// Small formatting helpers.
import { lang, t, type Lang } from "./i18n";

export const LANE_COLORS = [
  "#4f9dff",
  "#f2994a",
  "#3ecf8e",
  "#e05d7c",
  "#a78bfa",
  "#2dc6d6",
  "#e8c547",
  "#ff7a59",
  "#7bd88f",
  "#d77ee8",
  "#5aa9e6",
  "#c9a26b",
];

export const laneColor = (i: number) => LANE_COLORS[((i % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const personColor = (key: string) => LANE_COLORS[hash(key.toLowerCase()) % LANE_COLORS.length];

export function initials(name: string) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Formatters of the active language, rebuilt only when it changes (the graph formats many dates).
let fmt: { lang: Lang; rtf: Intl.RelativeTimeFormat; dtf: Intl.DateTimeFormat } | null = null;
function formatters() {
  const l = lang();
  if (fmt?.lang !== l) {
    fmt = {
      lang: l,
      rtf: new Intl.RelativeTimeFormat(l, { numeric: "auto" }),
      dtf: new Intl.DateTimeFormat(l, { dateStyle: "medium", timeStyle: "short" }),
    };
  }
  return fmt;
}

export function relativeTime(unix: number) {
  const diff = unix - Date.now() / 1000;
  const abs = Math.abs(diff);
  const { rtf } = formatters();
  if (abs < 60) return t("time.now");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return fullDate(unix);
}

export const fullDate = (unix: number) => formatters().dtf.format(new Date(unix * 1000));

export const shortHash = (h: string) => h.slice(0, 7);

export function basename(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

export function dirname(p: string) {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/");
}

/** Split `feature/x/y` style names into a folder tree. */
export interface TreeNode<T> {
  name: string;
  path: string;
  item?: T;
  children: TreeNode<T>[];
}

export function buildTree<T>(items: T[], nameOf: (t: T) => string): TreeNode<T>[] {
  const root: TreeNode<T> = { name: "", path: "", children: [] };
  for (const it of items) {
    const parts = nameOf(it).split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const leaf = i === parts.length - 1;
      if (leaf) {
        node.children.push({ name: part, path, children: [], item: it });
        return;
      }
      let folder = node.children.find((c) => c.name === part && !c.item);
      if (!folder) {
        folder = { name: part, path, children: [] };
        node.children.push(folder);
      }
      node = folder;
    });
  }
  const sort = (n: TreeNode<T>[]) => {
    n.sort((a, b) => (!!a.item === !!b.item ? a.name.localeCompare(b.name) : a.item ? 1 : -1));
    n.forEach((c) => sort(c.children));
  };
  sort(root.children);
  return root.children;
}
