import type { ReactNode } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  CloudDownload,
  FolderOpen,
  GitBranchPlus,
  GitPullRequestCreate,
  Inbox,
  Plus,
  RefreshCw,
  Settings as Gear,
  Workflow,
  X,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import * as A from "../actions";
import { useStore, type MenuItem, type RepoTab } from "../store";
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
        <button className="tb-caret" onClick={menu} disabled={disabled} aria-label={`Opzioni ${label}`}>
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
  return (
    <div className="tabbar">
      <div className="tabbar-logo" onClick={() => A.setActive(null)} title="Home">
        <Logo size={20} />
      </div>
      {tabs.map((t) => (
        <div
          key={t}
          className={`tab${t === active ? " active" : ""}`}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              A.closeTab(t);
            } else A.setActive(t);
          }}
          title={t}
        >
          <span className="tab-name">{repos[t]?.name ?? t}</span>
          <button
            className="tab-close"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              A.closeTab(t);
            }}
            aria-label="Chiudi scheda"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button className={`tab tab-new${active === null ? " active" : ""}`} onClick={() => A.setActive(null)} title="Apri, clona o crea un repository">
        <Plus size={14} />
      </button>
    </div>
  );
}

export function Toolbar({ tab }: { tab: RepoTab }) {
  const busy = useStore((s) => s.busy);
  const settings = useStore((s) => s.settings);
  const path = tab.path;
  const refreshing = useStore((s) => !!s.refreshing[path]);
  const o = tab.overview;
  const head = o?.head;
  const disabled = !!busy || !o;
  const pullMode = settings?.pullMode ?? "ff";
  const pullLabel = { ff: "fast-forward se possibile", "ff-only": "solo fast-forward", rebase: "rebase" }[pullMode];

  const pullMenu = (e: React.MouseEvent) => {
    const item = (mode: "ff" | "ff-only" | "rebase", label: string): MenuItem => ({
      label: `${label}${pullMode === mode ? "  ✓" : ""}`,
      action: () => {
        A.saveSettings({ pullMode: mode });
        A.pull(path, mode);
      },
    });
    A.showMenu(e, [item("ff", "Pull (fast-forward se possibile)"), item("ff-only", "Pull (solo fast-forward)"), item("rebase", "Pull (rebase)"), { separator: true }, { label: "Solo fetch di tutti i remote", action: () => A.fetchAll(path) }]);
  };

  const pushMenu = (e: React.MouseEvent) =>
    A.showMenu(e, [
      { label: "Push", action: () => A.push(path) },
      { label: "Force push (--force-with-lease)", danger: true, action: () => A.push(path, { force: true }) },
    ]);

  const flowMenu = (e: React.MouseEvent) => {
    const gf = o?.gitflow;
    if (!gf) {
      A.showMenu(e, [{ label: "Inizializza Git Flow…", action: () => A.gitflowInit(path) }]);
      return;
    }
    const kinds = ["feature", "bugfix", "release", "hotfix"] as const;
    const cur = head?.branch ?? "";
    const curKind = kinds.find((k) => cur.startsWith(gf[k]));
    const items: MenuItem[] = kinds.map((k) => ({ label: `Inizia ${k}…`, action: () => A.gitflowStart(path, k) }));
    if (curKind) {
      const name = cur.slice(gf[curKind].length);
      items.push({ separator: true }, { label: `Concludi ${curKind} ${name}…`, action: () => A.gitflowFinish(path, curKind, name) });
    }
    items.push({ separator: true }, { label: "Configurazione Git Flow…", action: () => A.gitflowInit(path) });
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
          {head?.branch ?? (head?.hash ? `HEAD staccato ${head.hash.slice(0, 7)}` : "nessun commit")}
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
        <button className="icon-btn" title="Mostra nel file manager" onClick={() => revealItemInDir(path).catch(() => {})}>
          <FolderOpen size={17} />
        </button>
        <button
          className="icon-btn"
          title={refreshing ? "Aggiornamento in corso…" : `Aggiorna (F5) — pull: ${pullLabel}`}
          aria-busy={refreshing}
          onClick={() => A.reload(path)}
        >
          <RefreshCw size={17} className={refreshing ? "spin" : undefined} />
        </button>
        <button className="icon-btn" title="Preferenze" onClick={() => useStore.getState().set({ modal: "preferences" })}>
          <Gear size={17} />
        </button>
      </div>
    </div>
  );
}
