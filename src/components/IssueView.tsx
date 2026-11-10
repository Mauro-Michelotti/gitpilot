import { useEffect, useState, type CSSProperties } from "react";
import { CircleCheck, CircleDot, ExternalLink, GitBranch, GitBranchPlus, Milestone, X } from "lucide-react";
import * as A from "../actions";
import { api, errorText } from "../api";
import { useT } from "../i18n";
import { useStore, type RepoTab } from "../store";
import type { BranchIssue, GitFlowKind, Issue, IssueDetail, RepoOverview } from "../types";
import { initials, issueOfBranch, personColor, relativeTime, slugify } from "../util";
import { Modal } from "./Overlays";

const when = (iso: string | null) => (iso ? relativeTime(Date.parse(iso) / 1000) : "");

function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar avatar-sm" style={{ background: personColor(name) }} title={name}>
      {initials(name)}
    </span>
  );
}

function IssueLabels({ issue }: { issue: Issue }) {
  return (
    <div className="issue-labels">
      {issue.labels.map((l) => (
        <span key={l.name} className="issue-label" style={l.color ? ({ "--label": l.color } as CSSProperties) : undefined}>
          {l.name}
        </span>
      ))}
    </div>
  );
}

/**
 * HTML already sanitized by the backend. Links never navigate the webview: issues of this
 * project open here, everything else in the browser.
 */
function Markdown({ html, path, o }: { html: string; path: string; o: RepoOverview }) {
  const follow = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    const web = o.provider?.webUrl;
    const own = web && href.startsWith(web) ? href.slice(web.length).match(/^\/(?:-\/)?issues\/(\d+)\/?(?:#.*)?$/) : null;
    if (own) A.openIssue(path, Number(own[1]));
    else if (/^(https?:|mailto:)/i.test(href)) A.openExternal(href);
  };
  return <div className="md selectable" onClick={follow} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function IssueView({ tab, number }: { tab: RepoTab; number: number }) {
  const t = useT();
  const path = tab.path;
  const o = tab.overview;
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [links, setLinks] = useState<BranchIssue[]>([]);

  useEffect(() => {
    let alive = true;
    setErr(null);
    setDetail((d) => (d?.issue.number === number ? d : null));
    api.issueDetail(path, number).then(
      (d) => alive && setDetail(d),
      (e) => alive && setErr(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [path, number, tab.issueRevision]);

  useEffect(() => {
    api.branchIssues(path).then(setLinks, () => setLinks([]));
  }, [path, number, tab.revision]);

  const close = () => useStore.getState().patchRepo(path, { view: { kind: "graph" } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (e.key === "Escape" && !st.prompt && !st.menu && !st.issueBranch) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const issue = detail?.issue ?? tab.issues?.find((i) => i.number === number);
  if (!o) return null;
  const providerName = o.provider?.kind === "gitlab" ? "GitLab" : "GitHub";

  const head = (
    <div className="issue-head">
      <div className="issue-title">
        <h2 className="selectable">
          {issue?.title ?? `#${number}`} <span className="muted">#{number}</span>
        </h2>
        {issue && (
          <div className="issue-sub">
            <span className={`issue-state ${issue.state}`}>
              {issue.state === "open" ? <CircleDot size={13} /> : <CircleCheck size={13} />}
              {issue.state === "open" ? t("issues.state.open") : t("issues.state.closed")}
            </span>
            <span className="muted">
              <strong className="issue-author">{issue.author}</strong> {t("issues.opened", { when: when(issue.createdAt) })} ·{" "}
              {t("issues.comments", { count: issue.comments })}
            </span>
          </div>
        )}
      </div>
      <div className="issue-actions">
        <button className="btn btn-primary" disabled={!issue} onClick={() => issue && A.issueBranchDialog(path, issue)}>
          <GitBranchPlus size={15} /> {t("issues.createBranch")}
        </button>
        {issue && (
          <button className="btn" onClick={() => A.openExternal(issue.webUrl)}>
            <ExternalLink size={14} /> {t("issues.openOn", { provider: providerName })}
          </button>
        )}
        <button className="icon-btn" onClick={close} title={`${t("issues.close")} (Esc)`}>
          <X size={17} />
        </button>
      </div>
    </div>
  );

  if (err && !detail) {
    return (
      <div className="issue-view">
        {head}
        <div className="empty big">
          <p className="error-text">{err}</p>
        </div>
      </div>
    );
  }

  const branches = o.locals.filter((b) => links.some((l) => l.branch === b.name && l.issue === number) || issueOfBranch(b.name) === number);
  const people = detail ? [...new Set([detail.issue.author, ...detail.comments.map((c) => c.author)].filter(Boolean))] : [];

  return (
    <div className="issue-view">
      {head}
      <div className="issue-body">
        <div className="issue-thread">
          {!detail ? (
            <p className="muted">{t("issues.loading")}</p>
          ) : (
            <>
              <article className="issue-comment">
                <header>
                  <Avatar name={detail.issue.author} />
                  <strong>{detail.issue.author}</strong>
                  <span className="muted">{when(detail.issue.createdAt)}</span>
                </header>
                {detail.bodyHtml.trim() ? (
                  <Markdown html={detail.bodyHtml} path={path} o={o} />
                ) : (
                  <p className="md muted">{t("issues.noDescription")}</p>
                )}
              </article>
              {detail.comments.map((c, i) => (
                <article key={i} className="issue-comment">
                  <header>
                    <Avatar name={c.author} />
                    <strong>{c.author}</strong>
                    <span className="muted">{when(c.createdAt)}</span>
                  </header>
                  <Markdown html={c.bodyHtml} path={path} o={o} />
                </article>
              ))}
            </>
          )}
        </div>
        {issue && (
          <aside className="issue-meta">
            <section>
              <h4>{t("issues.assignees")}</h4>
              {issue.assignees.length === 0 ? (
                <span className="muted">{t("issues.nobody")}</span>
              ) : (
                issue.assignees.map((a) => (
                  <div key={a} className="issue-person">
                    <Avatar name={a} /> {a}
                  </div>
                ))
              )}
            </section>
            <section>
              <h4>{t("issues.labels")}</h4>
              {issue.labels.length === 0 ? <span className="muted">{t("issues.noLabels")}</span> : <IssueLabels issue={issue} />}
            </section>
            <section>
              <h4>{t("issues.milestone")}</h4>
              {issue.milestone ? (
                <span className="issue-person">
                  <Milestone size={14} /> {issue.milestone}
                </span>
              ) : (
                <span className="muted">{t("issues.noMilestone")}</span>
              )}
            </section>
            <section>
              <h4>{t("issues.branches")}</h4>
              {branches.length === 0 ? (
                <span className="muted small">{t("issues.noBranches")}</span>
              ) : (
                branches.map((b) => (
                  <div
                    key={b.name}
                    className={`issue-branch${b.isHead ? " current" : ""}`}
                    onClick={() => A.selectCommit(path, b.hash)}
                    onDoubleClick={() => !b.isHead && A.checkoutBranch(path, b.name)}
                    title={b.isHead ? b.name : `${b.name}\n${t("issues.branchCheckout")}`}
                  >
                    <GitBranch size={13} />
                    <span className="mono">{b.name}</span>
                    {b.isHead && <span className="badge">{t("issues.branchCurrent")}</span>}
                  </div>
                ))
              )}
            </section>
            {people.length > 0 && (
              <section>
                <h4>{t("issues.participants")}</h4>
                <div className="issue-people">
                  {people.map((p) => (
                    <Avatar key={p} name={p} />
                  ))}
                </div>
              </section>
            )}
            {issue.updatedAt && <p className="muted small">{t("issues.updated", { when: when(issue.updatedAt) })}</p>}
          </aside>
        )}
      </div>
    </div>
  );
}

const FLOW_KINDS = ["feature", "bugfix", "hotfix"] as const;
const FLOW_LABEL: Record<(typeof FLOW_KINDS)[number], string> = { feature: "Feature", bugfix: "Bugfix", hotfix: "Hotfix" };

export function IssueBranchDialog() {
  const spec = useStore((s) => s.issueBranch);
  if (!spec) return null;
  return <IssueBranchForm key={`${spec.path}#${spec.issue.number}`} path={spec.path} issue={spec.issue} />;
}

function IssueBranchForm({ path, issue }: { path: string; issue: Issue }) {
  const t = useT();
  const o = useStore((s) => s.repos[path]?.overview);
  const gf = o?.gitflow ?? null;
  const isBug = issue.labels.some((l) => /bug/i.test(l.name));
  const defaultBase = (k: GitFlowKind | "plain") =>
    gf && k !== "plain" ? (k === "hotfix" ? gf.master : gf.develop) : (o?.head.branch ?? o?.locals[0]?.name ?? "");
  const [kind, setKind] = useState<GitFlowKind | "plain">(gf ? (isBug ? "bugfix" : "feature") : "plain");
  const [name, setName] = useState(`${issue.number}-${slugify(issue.title)}`);
  const [base, setBase] = useState(() => defaultBase(kind));
  const [checkout, setCheckout] = useState(true);
  const [link, setLink] = useState(true);

  const prefix = gf && kind !== "plain" ? gf[kind] : "";
  const branch = prefix + name.trim();
  const locals = o?.locals.map((b) => b.name) ?? [];
  const bases = !base || locals.includes(base) ? locals : [base, ...locals];
  const close = () => useStore.getState().set({ issueBranch: null });
  const submit = () => {
    if (!name.trim()) return;
    close();
    A.createIssueBranch(path, issue, { kind, name, base, checkout, link });
  };

  return (
    <Modal
      title={t("issues.branch.title")}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}>
            {t("issues.createBranch")}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="form-message">
          #{issue.number} {issue.title}
        </div>
        {gf && (
          <label className="field">
            <span className="field-label">{t("issues.branch.type")}</span>
            <select
              value={kind}
              onChange={(e) => {
                const k = e.target.value as GitFlowKind | "plain";
                setKind(k);
                setBase(defaultBase(k));
              }}
            >
              {FLOW_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t("issues.branch.typeFlow", { kind: FLOW_LABEL[k], prefix: gf[k] })}
                </option>
              ))}
              <option value="plain">{t("issues.branch.typePlain")}</option>
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">{t("issues.branch.name")}</span>
          <input className="mono" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoFocus />
          <span className="field-help">{t("issues.branch.result", { branch })}</span>
        </label>
        <label className="field">
          <span className="field-label">{t("issues.branch.base")}</span>
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            {bases.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
          {t("issues.branch.checkout")}
        </label>
        <label className="check">
          <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} />
          {t(o?.provider?.kind === "gitlab" ? "issues.branch.linkMr" : "issues.branch.link", { number: issue.number })}
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
