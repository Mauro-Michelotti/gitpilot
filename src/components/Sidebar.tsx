import { useState, type ReactNode } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Cloud,
  Flag,
  Folder,
  GitPullRequest,
  Laptop,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Tag,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import * as A from "../actions";
import { useT } from "../i18n";
import { issueMenu, localBranchMenu, prMenu, remoteBranchMenu, remoteMenu, stashMenu, tagMenu } from "../menus";
import { useStore, type RepoTab } from "../store";
import type { BranchInfo, GitFlowKind, Issue, ProviderLink, RemoteBranch } from "../types";
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
  const t = useT();
  const o = tab.overview;
  const path = tab.path;
  const selectedHash = tab.selection?.kind === "commit" ? tab.selection.hash : null;
  const accounts = useStore((s) => s.accounts);
  if (!o) return <aside className="sidebar" />;

  const locals = o.locals.filter((b) => match(q, b.name));
  const tags = o.tags.filter((tg) => match(q, tg.name));
  const stashes = o.stashes.filter((s) => match(q, s.message));
  const prs = (tab.prs ?? []).filter((p) => match(q, p.title) || match(q, p.sourceBranch));
  const issues = (tab.issues ?? []).filter((i) => match(q, i.title) || match(q.replace(/^#/, ""), String(i.number)));
  const openIssue = tab.view.kind === "issue" ? tab.view.number : null;
  const filter = tab.issueFilter;
  const provider = o.provider && o.provider.kind !== "unknown" ? o.provider : null;
  const isGh = provider?.kind === "github";

  const branchRow = (b: BranchInfo, n: TreeNode<BranchInfo>, depth: number) => (
    <div
      className={`sb-item${b.isHead ? " current" : ""}${selectedHash === b.hash ? " selected" : ""}`}
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={() => A.selectCommit(path, b.hash)}
      onDoubleClick={() => !b.isHead && A.checkoutBranch(path, b.name)}
      onContextMenu={(e) => A.showMenu(e, localBranchMenu(path, o, b.name))}
      title={b.upstream ? `${b.name} → ${b.upstream}${b.gone ? t("sidebar.gone") : ""}` : t("sidebar.localOnly", { name: b.name })}
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
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("sidebar.filter")} spellCheck={false} />
      </div>
      <div className="sb-scroll">
        <Section
          id="local"
          title={t("sidebar.locals")}
          icon={<Laptop size={14} />}
          count={o.locals.length}
          actions={
            <button className="icon-btn" title={t("sidebar.newBranch")} onClick={() => A.createBranch(path)}>
              <Plus size={14} />
            </button>
          }
        >
          <Tree nodes={buildTree(locals, (b) => b.name)} depth={0} render={branchRow} />
        </Section>

        <Section
          id="remote"
          title={t("sidebar.remotes")}
          icon={<Cloud size={14} />}
          count={o.remotes.length}
          actions={
            <button className="icon-btn" title={t("sidebar.addRemote")} onClick={() => A.addRemote(path)}>
              <Plus size={14} />
            </button>
          }
        >
          {o.remotes.length === 0 && <div className="sb-empty">{t("sidebar.noRemotes")}</div>}
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
                <button className="icon-btn" title={t("sidebar.refresh")} onClick={() => A.loadPullRequests(path)}>
                  <RefreshCw size={13} className={tab.prLoading ? "spin" : undefined} />
                </button>
                <button className="icon-btn" title={isGh ? t("sidebar.newPr") : t("sidebar.newMr")} onClick={() => A.createPullRequest(path)}>
                  <Plus size={14} />
                </button>
              </>
            }
          >
            {!provider.accountId ? (
              <NoAccount provider={provider} hasAccounts={accounts.length > 0} />
            ) : tab.prError ? (
              <div className="sb-empty error-text">{tab.prError}</div>
            ) : prs.length === 0 ? (
              <div className="sb-empty">{tab.prLoading ? t("sidebar.loading") : t("sidebar.noRequests")}</div>
            ) : (
              prs.map((p) => (
                <div
                  key={p.number}
                  className="sb-item sb-pr"
                  onDoubleClick={() => A.openExternal(p.webUrl)}
                  onContextMenu={(e) => A.showMenu(e, prMenu(path, o, p))}
                  title={`${p.title}\n${p.sourceBranch} → ${p.targetBranch}\n${t("sidebar.prBy", { author: p.author })}${p.updatedAt ? t("sidebar.prUpdated", { when: relativeTime(Date.parse(p.updatedAt) / 1000) }) : ""}`}
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

        {provider && (
          <Section
            id="issues"
            title={t("issues.section")}
            icon={<CircleDot size={14} />}
            count={tab.issues?.length}
            actions={
              <>
                <button className="icon-btn" title={t("sidebar.refresh")} onClick={() => A.loadIssues(path)}>
                  <RefreshCw size={13} className={tab.issueLoading ? "spin" : undefined} />
                </button>
                <button className="icon-btn" title={t("issues.new")} onClick={() => A.openExternal(A.newIssueUrl(o))}>
                  <Plus size={14} />
                </button>
              </>
            }
          >
            {!provider.accountId ? (
              <NoAccount provider={provider} hasAccounts={accounts.length > 0} />
            ) : (
              <>
                <div className="sb-chips">
                  <button className={`sb-chip${filter.state === "open" ? " on" : ""}`} onClick={() => A.setIssueFilter(path, { state: "open" })}>
                    {t("issues.filter.open")}
                  </button>
                  <button className={`sb-chip${filter.mine ? " on" : ""}`} onClick={() => A.setIssueFilter(path, { mine: !filter.mine })}>
                    {t("issues.filter.mine")}
                  </button>
                  <button className={`sb-chip${filter.state === "closed" ? " on" : ""}`} onClick={() => A.setIssueFilter(path, { state: "closed" })}>
                    {t("issues.filter.closed")}
                  </button>
                </div>
                {tab.issueError ? (
                  <div className="sb-empty error-text">{tab.issueError}</div>
                ) : issues.length === 0 ? (
                  <div className="sb-empty">
                    {tab.issueLoading || !tab.issues
                      ? t("sidebar.loading")
                      : filter.mine
                        ? t("issues.emptyMine")
                        : filter.state === "closed"
                          ? t("issues.emptyClosed")
                          : t("issues.emptyOpen")}
                  </div>
                ) : (
                  issues.map((i) => (
                    <div
                      key={i.number}
                      className={`sb-item sb-issue${openIssue === i.number ? " selected" : ""}`}
                      onClick={() => A.openIssue(path, i.number)}
                      onContextMenu={(e) => A.showMenu(e, issueMenu(path, i))}
                      title={issueTip(i, t)}
                    >
                      {i.state === "open" ? <CircleDot size={13} className="issue-open" /> : <CircleCheck size={13} className="issue-closed" />}
                      <span className="sb-label">
                        <span className="muted">#{i.number}</span> {i.title}
                      </span>
                      {i.comments > 0 && (
                        <span className="sb-meta issue-comments">
                          <MessageSquare size={11} />
                          {i.comments}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </>
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
              {t("sidebar.flowNotInit")}{" "}
              <a onClick={() => A.gitflowInit(path)}>{t("sidebar.flowInit")}</a>
            </div>
          ) : (
            flowKinds.map((k) => {
              const items = o.locals.filter((b) => gf[k] && b.name.startsWith(gf[k]) && match(q, b.name));
              return (
                <div key={k}>
                  <div className="sb-item sb-flow-head" style={{ paddingLeft: 12 }}>
                    <Flag size={13} className="muted" />
                    <span className="sb-label">{flowLabel[k]}</span>
                    <button className="icon-btn" title={t("sidebar.flowStart", { kind: k })} onClick={() => A.gitflowStart(path, k)}>
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
                          {t("sidebar.flowFinish")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </Section>

        <Section id="tags" title={t("sidebar.tags")} icon={<Tag size={14} />} count={o.tags.length} defaultOpen={false}>
          {tags.map((tg) => (
            <div
              key={tg.name}
              className={`sb-item${selectedHash === tg.hash ? " selected" : ""}`}
              style={{ paddingLeft: 12 }}
              onClick={() => A.selectCommit(path, tg.hash)}
              onContextMenu={(e) => A.showMenu(e, tagMenu(path, o, tg.name))}
            >
              <Tag size={13} className="muted" />
              <span className="sb-label">{tg.name}</span>
            </div>
          ))}
        </Section>

        <Section id="stash" title={t("sidebar.stash")} icon={<Archive size={14} />} count={o.stashes.length}>
          {stashes.length === 0 && <div className="sb-empty">{t("sidebar.noStash")}</div>}
          {stashes.map((s) => (
            <div
              key={s.hash}
              className="sb-item"
              style={{ paddingLeft: 12 }}
              onDoubleClick={() => A.stashApply(path, s.index, false)}
              onContextMenu={(e) => A.showMenu(e, stashMenu(path, s.index))}
              title={`stash@{${s.index}} — ${relativeTime(s.time)}\n${t("sidebar.stashHint")}`}
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

function NoAccount({ provider, hasAccounts }: { provider: ProviderLink; hasAccounts: boolean }) {
  const t = useT();
  return (
    <div className="sb-empty">
      {t("sidebar.noAccount", { host: provider.host })}{" "}
      <a onClick={() => useStore.getState().set({ modal: "preferences" })}>{t("sidebar.connect", { provider: provider.kind === "github" ? "GitHub" : "GitLab" })}</a>
      {hasAccounts && t("sidebar.hostMismatch")}
    </div>
  );
}

function issueTip(i: Issue, t: ReturnType<typeof useT>) {
  return [
    `#${i.number} ${i.title}`,
    t("issues.tip.by", { author: i.author }),
    i.labels.length ? t("issues.tip.labels", { labels: i.labels.map((l) => l.name).join(", ") }) : "",
    i.assignees.length ? t("issues.tip.assignees", { names: i.assignees.join(", ") }) : "",
    i.updatedAt ? t("issues.tip.updated", { when: relativeTime(Date.parse(i.updatedAt) / 1000) }) : "",
  ]
    .filter(Boolean)
    .join("\n");
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
