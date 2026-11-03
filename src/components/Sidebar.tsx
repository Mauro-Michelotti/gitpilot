import { useState, type ReactNode } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Cloud,
  Flag,
  Folder,
  GitPullRequest,
  Laptop,
  Plus,
  RefreshCw,
  Search,
  Tag,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import * as A from "../actions";
import { localBranchMenu, prMenu, remoteBranchMenu, remoteMenu, stashMenu, tagMenu } from "../menus";
import { useStore, type RepoTab } from "../store";
import type { BranchInfo, GitFlowKind, RemoteBranch } from "../types";
import { buildTree, relativeTime, type TreeNode } from "../util";
import { ProviderIcon } from "./icons";

function Section({
  id,
  title,
  icon,
  count,
  actions,
  children,
  defaultOpen = true,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const key = `gp.section.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key, open ? "0" : "1");
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <section className="sb-section">
      <div className="sb-head" onClick={toggle}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="sb-icon">{icon}</span>
        <span className="sb-title">{title}</span>
        {count !== undefined && <span className="sb-count">{count}</span>}
        <span className="sb-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      </div>
      {open && <div className="sb-body">{children}</div>}
    </section>
  );
}

function Tree<T>({
  nodes,
  depth,
  render,
}: {
  nodes: TreeNode<T>[];
  depth: number;
  render: (item: T, node: TreeNode<T>, depth: number) => ReactNode;
}) {
  return (
    <>
      {nodes.map((n) =>
        n.item !== undefined ? (
          <div key={"i:" + n.path}>{render(n.item, n, depth)}</div>
        ) : (
          <Folder_ key={"f:" + n.path} node={n} depth={depth} render={render} />
        ),
      )}
    </>
  );
}

function Folder_<T>({ node, depth, render }: { node: TreeNode<T>; depth: number; render: (item: T, node: TreeNode<T>, depth: number) => ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="sb-item sb-folder" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Folder size={13} className="muted" />
        <span className="sb-label">{node.name}</span>
      </div>
      {open && <Tree nodes={node.children} depth={depth + 1} render={render} />}
    </>
  );
}

const match = (q: string, s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

export function Sidebar({ tab }: { tab: RepoTab }) {
  const [q, setQ] = useState("");
  const o = tab.overview;
  const path = tab.path;
  const selectedHash = tab.selection?.kind === "commit" ? tab.selection.hash : null;
  const accounts = useStore((s) => s.accounts);
  if (!o) return <aside className="sidebar" />;

  const locals = o.locals.filter((b) => match(q, b.name));
  const tags = o.tags.filter((t) => match(q, t.name));
  const stashes = o.stashes.filter((s) => match(q, s.message));
  const prs = (tab.prs ?? []).filter((p) => match(q, p.title) || match(q, p.sourceBranch));
  const provider = o.provider && o.provider.kind !== "unknown" ? o.provider : null;
  const isGh = provider?.kind === "github";

  const branchRow = (b: BranchInfo, n: TreeNode<BranchInfo>, depth: number) => (
    <div
      className={`sb-item${b.isHead ? " current" : ""}${selectedHash === b.hash ? " selected" : ""}`}
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={() => A.selectCommit(path, b.hash)}
      onDoubleClick={() => !b.isHead && A.checkoutBranch(path, b.name)}
      onContextMenu={(e) => A.showMenu(e, localBranchMenu(path, o, b.name))}
      title={b.upstream ? `${b.name} → ${b.upstream}${b.gone ? " (eliminato sul remote)" : ""}` : `${b.name} (solo locale)`}
    >
      <Laptop size={13} className={b.isHead ? "accent" : "muted"} />
      <span className="sb-label">{n.name}</span>
      <span className="sb-meta">
        {b.gone && <TriangleAlert size={12} className="warn" />}
        {b.behind > 0 && (
          <span className="ab">
            <ArrowDown size={11} />
            {b.behind}
          </span>
        )}
        {b.ahead > 0 && (
          <span className="ab">
            <ArrowUp size={11} />
            {b.ahead}
          </span>
        )}
      </span>
    </div>
  );

  const remoteRow = (b: RemoteBranch, n: TreeNode<RemoteBranch>, depth: number) => (
    <div
      className={`sb-item${selectedHash === b.hash ? " selected" : ""}`}
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={() => A.selectCommit(path, b.hash)}
      onDoubleClick={() => A.checkoutRemote(path, b.full)}
      onContextMenu={(e) => A.showMenu(e, remoteBranchMenu(path, o, b.full))}
      title={b.full}
    >
      <Cloud size={13} className="muted" />
      <span className="sb-label">{n.name}</span>
    </div>
  );

  const gf = o.gitflow;
  const flowKinds: GitFlowKind[] = ["feature", "bugfix", "release", "hotfix"];
  const flowLabel: Record<GitFlowKind, string> = { feature: "Feature", bugfix: "Bugfix", release: "Release", hotfix: "Hotfix" };

  return (
    <aside className="sidebar">
      <div className="sb-search">
        <Search size={14} className="muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtra branch, tag, PR…" spellCheck={false} />
      </div>
      <div className="sb-scroll">
        <Section
          id="local"
          title="Locali"
          icon={<Laptop size={14} />}
          count={o.locals.length}
          actions={
            <button className="icon-btn" title="Nuovo branch" onClick={() => A.createBranch(path)}>
              <Plus size={14} />
            </button>
          }
        >
          <Tree nodes={buildTree(locals, (b) => b.name)} depth={0} render={branchRow} />
        </Section>

        <Section
          id="remote"
          title="Remoti"
          icon={<Cloud size={14} />}
          count={o.remotes.length}
          actions={
            <button className="icon-btn" title="Aggiungi remote" onClick={() => A.addRemote(path)}>
              <Plus size={14} />
            </button>
          }
        >
          {o.remotes.length === 0 && <div className="sb-empty">Nessun remote. Aggiungine uno per pubblicare.</div>}
          {o.remotes.map((r) => {
            const branches = r.branches.filter((b) => match(q, b.full));
            return (
              <RemoteGroup key={r.name} name={r.name} url={r.url} onMenu={(e) => A.showMenu(e, remoteMenu(path, r.name, r.url))}>
                <Tree nodes={buildTree(branches, (b) => b.name)} depth={1} render={remoteRow} />
              </RemoteGroup>
            );
          })}
        </Section>

        {provider && (
          <Section
            id="prs"
            title={isGh ? "Pull request" : "Merge request"}
            icon={<GitPullRequest size={14} />}
            count={tab.prs?.length}
            actions={
              <>
                <button className="icon-btn" title="Aggiorna" onClick={() => A.loadPullRequests(path)}>
                  <RefreshCw size={13} className={tab.prLoading ? "spin" : undefined} />
                </button>
                <button className="icon-btn" title={isGh ? "Nuova pull request" : "Nuova merge request"} onClick={() => A.createPullRequest(path)}>
                  <Plus size={14} />
                </button>
              </>
            }
          >
            {!provider.accountId ? (
              <div className="sb-empty">
                Nessun account per {provider.host}.{" "}
                <a onClick={() => useStore.getState().set({ modal: "preferences" })}>Collega {isGh ? "GitHub" : "GitLab"}</a>
                {accounts.length > 0 && " (l'host non corrisponde agli account configurati)"}
              </div>
            ) : tab.prError ? (
              <div className="sb-empty error-text">{tab.prError}</div>
            ) : prs.length === 0 ? (
              <div className="sb-empty">{tab.prLoading ? "Caricamento…" : "Nessuna richiesta aperta"}</div>
            ) : (
              prs.map((p) => (
                <div
                  key={p.number}
                  className="sb-item sb-pr"
                  onDoubleClick={() => A.openExternal(p.webUrl)}
                  onContextMenu={(e) => A.showMenu(e, prMenu(path, o, p))}
                  title={`${p.title}\n${p.sourceBranch} → ${p.targetBranch}\ndi ${p.author}${p.updatedAt ? ", aggiornata " + relativeTime(Date.parse(p.updatedAt) / 1000) : ""}`}
                >
                  <ProviderIcon kind={provider.kind} size={13} />
                  <span className="sb-label">
                    <span className="muted">#{p.number}</span> {p.title}
                  </span>
                  {p.draft && <span className="badge">draft</span>}
                </div>
              ))
            )}
          </Section>
        )}

        <Section
          id="gitflow"
          title="Git Flow"
          icon={<Workflow size={14} />}
          defaultOpen={!!gf}
        >
          {!gf ? (
            <div className="sb-empty">
              Git Flow non inizializzato.{" "}
              <a onClick={() => A.gitflowInit(path)}>Inizializza</a>
            </div>
          ) : (
            flowKinds.map((k) => {
              const items = o.locals.filter((b) => gf[k] && b.name.startsWith(gf[k]) && match(q, b.name));
              return (
                <div key={k}>
                  <div className="sb-item sb-flow-head" style={{ paddingLeft: 12 }}>
                    <Flag size={13} className="muted" />
                    <span className="sb-label">{flowLabel[k]}</span>
                    <button className="icon-btn" title={`Inizia ${k}`} onClick={() => A.gitflowStart(path, k)}>
                      <Plus size={13} />
                    </button>
                  </div>
                  {items.map((b) => {
                    const name = b.name.slice(gf[k].length);
                    return (
                      <div
                        key={b.name}
                        className={`sb-item${b.isHead ? " current" : ""}`}
                        style={{ paddingLeft: 30 }}
                        onClick={() => A.selectCommit(path, b.hash)}
                        onDoubleClick={() => !b.isHead && A.checkoutBranch(path, b.name)}
                        onContextMenu={(e) => A.showMenu(e, localBranchMenu(path, o, b.name))}
                      >
                        <span className="sb-label">{name}</span>
                        <button className="btn btn-xs" onClick={(e) => { e.stopPropagation(); A.gitflowFinish(path, k, name); }}>
                          Concludi
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </Section>

        <Section id="tags" title="Tag" icon={<Tag size={14} />} count={o.tags.length} defaultOpen={false}>
          {tags.map((t) => (
            <div
              key={t.name}
              className={`sb-item${selectedHash === t.hash ? " selected" : ""}`}
              style={{ paddingLeft: 12 }}
              onClick={() => A.selectCommit(path, t.hash)}
              onContextMenu={(e) => A.showMenu(e, tagMenu(path, o, t.name))}
            >
              <Tag size={13} className="muted" />
              <span className="sb-label">{t.name}</span>
            </div>
          ))}
        </Section>

        <Section id="stash" title="Stash" icon={<Archive size={14} />} count={o.stashes.length}>
          {stashes.length === 0 && <div className="sb-empty">Nessuno stash</div>}
          {stashes.map((s) => (
            <div
              key={s.hash}
              className="sb-item"
              style={{ paddingLeft: 12 }}
              onDoubleClick={() => A.stashApply(path, s.index, false)}
              onContextMenu={(e) => A.showMenu(e, stashMenu(path, s.index))}
              title={`stash@{${s.index}} — ${relativeTime(s.time)}\nDoppio clic per applicare`}
            >
              <Archive size={13} className="muted" />
              <span className="sb-label">{s.message}</span>
            </div>
          ))}
        </Section>
      </div>
    </aside>
  );
}

function RemoteGroup({ name, url, children, onMenu }: { name: string; url: string; children: ReactNode; onMenu: (e: React.MouseEvent) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="sb-item sb-folder" style={{ paddingLeft: 12 }} onClick={() => setOpen(!open)} onContextMenu={onMenu} title={url}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Cloud size={13} className="muted" />
        <span className="sb-label">{name}</span>
      </div>
      {open && children}
    </>
  );
}
