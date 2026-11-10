import type { ReactNode } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Ellipsis,
  FolderOpen,
  GitBranchPlus,
  GitPullRequestCreate,
  Inbox,
  Layers,
  Plus,
  RefreshCw,
  Settings as Gear,
  TriangleAlert,
  Workflow,
  X,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import * as A from "../actions";
import { useT } from "../i18n";
import { addToGroupMenu, groupMenu, groupRepoMenu, repoTabMenu } from "../menus";
import { useActiveGroup, useStore, type MenuItem, type RepoTab } from "../store";
import { Logo } from "./icons";

function TbButton({
  icon,
  label,
  onClick,
  disabled,
  badge,
  menu,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  badge?: ReactNode;
  menu?: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  return (
    <div className="tb-btn-wrap">
      <button className="tb-btn" onClick={onClick} disabled={disabled} title={label}>
        <span className="tb-icon">
          {icon}
          {badge}
        </span>
        <span className="tb-label">{label}</span>
      </button>
      {menu && (
        <button className="tb-caret" onClick={menu} disabled={disabled} aria-label={t("toolbar.options", { label })}>
          <ChevronDown size={12} />
        </button>
      )}
    </div>
  );
}

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const repos = useStore((s) => s.repos);
  const selection = useStore((s) => s.tabSelection);
  const groups = useStore((s) => s.settings?.groups);
  const t = useT();
  return (
    <div className="tabbar">
      <div className="tabbar-logo" onClick={() => A.setActive(null)} title="Home">
        <Logo size={20} />
      </div>
      {tabs.map((entry) => {
        const g = groups?.find((x) => x.id === entry);
        const isActive = g ? !!active && g.repos.includes(active) : entry === active;
        const cls = `tab${isActive ? " active" : ""}${selection.includes(entry) ? " selected" : ""}${g ? " tab-group" : ""}`;
        return (
          <div
            key={entry}
            className={cls}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                A.closeTab(entry);
              } else if (e.button === 0) {
                if (!g && (e.ctrlKey || e.metaKey)) return A.toggleTabSelection(entry);
                A.clearTabSelection();
                A.setActive(A.repoOfTab(entry));
              }
            }}
            onContextMenu={(e) => A.showMenu(e, g ? groupMenu(entry) : repoTabMenu(entry))}
            title={g ? g.repos.map((p) => repos[p]?.name ?? p).join(", ") : `${entry}\n${t("groups.tab.select")}`}
          >
            {g && <Layers size={13} className="tab-group-icon" />}
            <span className="tab-name">{g ? g.name : (repos[entry]?.name ?? entry)}</span>
            {g && <span className="tab-count">{g.repos.length}</span>}
            <button
              className="tab-close"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                A.closeTab(entry);
              }}
              aria-label={g ? t("groups.menu.close") : t("toolbar.closeTab")}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button className={`tab tab-new${active === null ? " active" : ""}`} onClick={() => A.setActive(null)} title={t("toolbar.newTab")}>
        <Plus size={14} />
      </button>
    </div>
  );
}

/** Second-level tabs: the repositories of the group on screen. */
export function GroupBar() {
  const g = useActiveGroup();
  const active = useStore((s) => s.active);
  const repos = useStore((s) => s.repos);
  const t = useT();
  if (!g) return null;
  return (
    <div className="groupbar">
      <button className="groupbar-name" onClick={(e) => A.showMenu(e, groupMenu(g.id))} title={t("groups.bar.options")}>
        <Layers size={14} />
        <span>{g.name}</span>
        <ChevronRight size={13} className="muted" />
      </button>
      {g.repos.map((p) => {
        const r = repos[p];
        const head = r?.overview?.head;
        const branch = head?.branch ?? head?.hash?.slice(0, 7);
        const st = r?.status;
        const dirty = !!st && st.staged.length + st.unstaged.length + st.conflicted.length > 0;
        const broken = !!r?.error && !r.overview;
        return (
          <div
            key={p}
            className={`subtab${p === active ? " active" : ""}${broken ? " broken" : ""}`}
            onMouseDown={(e) => e.button === 0 && A.setActive(p)}
            onContextMenu={(e) => A.showMenu(e, groupRepoMenu(p))}
            title={broken ? `${p}\n${r?.error}` : p}
          >
            {broken && <TriangleAlert size={12} />}
            <span className="subtab-name">{r?.name ?? p}</span>
            {branch && <span className="subtab-branch">{branch}</span>}
            {dirty && <span className="subtab-dirty" title={t("groups.bar.dirty")} />}
          </div>
        );
      })}
      <button className="subtab subtab-add" onClick={(e) => A.showMenu(e, addToGroupMenu(g.id))} title={t("groups.bar.add")}>
        <Plus size={14} />
      </button>
      <span className="grow" />
      <button className="icon-btn groupbar-more" onClick={(e) => A.showMenu(e, groupMenu(g.id))} title={t("groups.bar.options")}>
        <Ellipsis size={16} />
      </button>
    </div>
  );
}

export function Toolbar({ tab }: { tab: RepoTab }) {
  const t = useT();
  const busy = useStore((s) => s.busy);
  const settings = useStore((s) => s.settings);
  const path = tab.path;
  const refreshing = useStore((s) => !!s.refreshing[path]);
  const o = tab.overview;
  const head = o?.head;
  const disabled = !!busy || !o;
  const pullMode = settings?.pullMode ?? "ff";
  const pullLabel = { ff: t("toolbar.pullMode.ff"), "ff-only": t("toolbar.pullMode.ffOnly"), rebase: t("toolbar.pullMode.rebase") }[pullMode];

  const pullMenu = (e: React.MouseEvent) => {
    const item = (mode: "ff" | "ff-only" | "rebase", label: string): MenuItem => ({
      label: `${label}${pullMode === mode ? "  ✓" : ""}`,
      action: () => {
        A.saveSettings({ pullMode: mode });
        A.pull(path, mode);
      },
    });
    A.showMenu(e, [
      item("ff", t("toolbar.pull.ff")),
      item("ff-only", t("toolbar.pull.ffOnly")),
      item("rebase", t("toolbar.pull.rebase")),
      { separator: true },
      { label: t("toolbar.pullAll"), action: () => A.pullAllBranches(path) },
      { label: t("toolbar.fetchOnly"), action: () => A.fetchAll(path) },
    ]);
  };

  const pushMenu = (e: React.MouseEvent) =>
    A.showMenu(e, [
      { label: "Push", action: () => A.push(path) },
      { label: "Force push (--force-with-lease)", danger: true, action: () => A.push(path, { force: true }) },
    ]);

  const flowMenu = (e: React.MouseEvent) => {
    const gf = o?.gitflow;
    if (!gf) {
      A.showMenu(e, [{ label: t("toolbar.flow.init"), action: () => A.gitflowInit(path) }]);
      return;
    }
    const kinds = ["feature", "bugfix", "release", "hotfix"] as const;
    const cur = head?.branch ?? "";
    const curKind = kinds.find((k) => cur.startsWith(gf[k]));
    const items: MenuItem[] = kinds.map((k) => ({ label: t("toolbar.flow.start", { kind: k }), action: () => A.gitflowStart(path, k) }));
    if (curKind) {
      const name = cur.slice(gf[curKind].length);
      items.push({ separator: true }, { label: t("toolbar.flow.finish", { kind: curKind, name }), action: () => A.gitflowFinish(path, curKind, name) });
    }
    items.push({ separator: true }, { label: t("toolbar.flow.config"), action: () => A.gitflowInit(path) });
    A.showMenu(e, items);
  };

  const hasStash = (o?.stashes.length ?? 0) > 0;
  const provider = o?.provider && o.provider.kind !== "unknown" ? o.provider : null;

  return (
    <div className="toolbar">
      <div className="tb-repo">
        <div className="tb-repo-name" title={path}>
          {tab.name}
        </div>
        <div className="tb-branch">
          {head?.branch ?? (head?.hash ? t("toolbar.detachedHead", { hash: head.hash.slice(0, 7) }) : t("toolbar.noCommits"))}
          {head?.upstream && <span className="muted"> → {head.upstream}</span>}
        </div>
      </div>
      <div className="tb-group">
        <TbButton
          icon={<ArrowDownToLine size={18} />}
          label="Pull"
          onClick={() => A.pull(path)}
          disabled={disabled}
          menu={pullMenu}
          badge={head && head.behind > 0 ? <span className="tb-badge">{head.behind}</span> : undefined}
        />
        <TbButton
          icon={<ArrowUpFromLine size={18} />}
          label="Push"
          onClick={() => A.push(path)}
          disabled={disabled || !head?.branch}
          menu={pushMenu}
          badge={head && head.ahead > 0 ? <span className="tb-badge">{head.ahead}</span> : undefined}
        />
        <TbButton icon={<CloudDownload size={18} />} label="Fetch" onClick={() => A.fetchAll(path)} disabled={disabled || !o?.remotes.length} />
      </div>
      <div className="tb-group">
        <TbButton icon={<GitBranchPlus size={18} />} label="Branch" onClick={() => A.createBranch(path)} disabled={disabled || !head?.hash} />
        <TbButton icon={<Archive size={18} />} label="Stash" onClick={() => A.stashSave(path)} disabled={disabled || !head?.hash} />
        <TbButton icon={<Inbox size={18} />} label="Pop" onClick={() => A.stashApply(path, 0, true)} disabled={disabled || !hasStash} />
      </div>
      <div className="tb-group">
        <TbButton icon={<Workflow size={18} />} label="Git Flow" onClick={() => {}} menu={flowMenu} disabled={disabled} />
        {provider && (
          <TbButton
            icon={<GitPullRequestCreate size={18} />}
            label={provider.kind === "gitlab" ? "Merge request" : "Pull request"}
            onClick={() => A.createPullRequest(path)}
            disabled={disabled || !head?.branch}
          />
        )}
      </div>
      <div className="tb-spacer" />
      {busy && (
        <div className="tb-busy">
          <RefreshCw size={14} className="spin" /> {busy}…
        </div>
      )}
      <div className="tb-group">
        <button className="icon-btn" title={t("toolbar.reveal")} onClick={() => revealItemInDir(path).catch(() => {})}>
          <FolderOpen size={17} />
        </button>
        <button
          className="icon-btn"
          title={refreshing ? t("toolbar.refreshing") : t("toolbar.refresh", { mode: pullLabel })}
          aria-busy={refreshing}
          onClick={() => A.reload(path)}
        >
          <RefreshCw size={17} className={refreshing ? "spin" : undefined} />
        </button>
        <button className="icon-btn" title={t("toolbar.preferences")} onClick={() => useStore.getState().set({ modal: "preferences" })}>
          <Gear size={17} />
        </button>
      </div>
    </div>
  );
}
