import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, FileText, GitCommitHorizontal, Minus, Plus, TriangleAlert, Undo2 } from "lucide-react";
import * as A from "../actions";
import { api, errorText } from "../api";
import { useStore, type RepoTab } from "../store";
import type { CommitDetails, FileChange } from "../types";
import { basename, CONFLICT_LABEL, dirname, fullDate, initials, personColor, STATUS_LABEL } from "../util";

export function DetailPanel({ tab }: { tab: RepoTab }) {
  if (tab.selection?.kind === "commit") return <CommitPanel tab={tab} hash={tab.selection.hash} />;
  return <WipPanel tab={tab} />;
}

function StatusBadge({ status }: { status: string }) {
  const s = status === "?" ? "A" : status;
  return (
    <span className={`fstatus fstatus-${s}`} title={STATUS_LABEL[status] ?? status}>
      {s}
    </span>
  );
}

function FileName({ path, oldPath }: { path: string; oldPath?: string | null }) {
  const dir = dirname(path);
  return (
    <span className="fname" title={oldPath ? `${oldPath} → ${path}` : path}>
      <span className="fname-base">{basename(path)}</span>
      {dir && <span className="fname-dir">{dir}</span>}
    </span>
  );
}

// ---------------------------------------------------------------- WIP

const drafts = new Map<string, { summary: string; desc: string }>();

function WipPanel({ tab }: { tab: RepoTab }) {
  const path = tab.path;
  const st = tab.status;
  const o = tab.overview;
  const busy = useStore((s) => s.busy);
  const draft = drafts.get(path) ?? { summary: "", desc: "" };
  const [summary, setSummary] = useState(draft.summary);
  const [desc, setDesc] = useState(draft.desc);
  const [amend, setAmend] = useState(false);
  const summaryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = drafts.get(path) ?? { summary: "", desc: "" };
    setSummary(d.summary);
    setDesc(d.desc);
    setAmend(false);
  }, [path]);

  useEffect(() => {
    drafts.set(path, { summary, desc });
  }, [path, summary, desc]);

  // Prefill with the prepared merge/cherry-pick message.
  const prepared = o?.state.message;
  useEffect(() => {
    if (prepared && !summary) {
      const [s, ...rest] = prepared.split("\n");
      setSummary(s);
      setDesc(rest.join("\n").trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared]);

  const onAmend = async (on: boolean) => {
    setAmend(on);
    if (on && !summary.trim()) {
      const msg = await api.lastCommitMessage(path).catch(() => "");
      const [s, ...rest] = msg.split("\n");
      setSummary(s);
      setDesc(rest.join("\n").trim());
    }
  };

  const staged = st?.staged ?? [];
  const unstaged = st?.unstaged ?? [];
  const conflicted = st?.conflicted ?? [];
  const canCommit = (staged.length > 0 || amend || (o?.state.kind === "merge" && conflicted.length === 0)) && summary.trim().length > 0 && !busy;

  const doCommit = async () => {
    if (!canCommit) return;
    const message = summary.trim() + (desc.trim() ? "\n\n" + desc.trim() : "");
    const r = await A.run("Commit", () => api.commit(path, message, amend), { path, success: (h) => `Commit ${h} creato` });
    if (r !== undefined) {
      setSummary("");
      setDesc("");
      setAmend(false);
      drafts.delete(path);
    }
  };

  const view = tab.view;
  const isOpen = (f: FileChange, stagedList: boolean) =>
    view.kind === "diff" && view.source.kind === "working" && view.source.file.path === f.path && view.source.staged === stagedList;
  const openDiff = (file: FileChange, isStaged: boolean) =>
    useStore.getState().patchRepo(path, { view: { kind: "diff", source: { kind: "working", file, staged: isStaged } } });

  const stage = (files: FileChange[]) =>
    A.run("Stage", () => api.stage(path, files.map((f) => f.path)), { path });
  const unstage = (files: FileChange[]) =>
    A.run("Unstage", () => api.unstage(path, files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))), { path });

  const branch = o?.head.branch ?? (o?.head.hash ? `HEAD ${o.head.hash.slice(0, 7)}` : "");
  const total = staged.length + unstaged.length + conflicted.length;

  return (
    <div className="panel wip-panel">
      <div className="panel-head">
        <div className="panel-title">
          {total ? `${total} file modificati` : "Nessuna modifica"} {branch && <span className="muted">su {branch}</span>}
        </div>
        {total > 0 && (
          <button className="icon-btn danger" title="Scarta tutte le modifiche" onClick={() => A.discardAll(path)}>
            <Undo2 size={15} />
          </button>
        )}
      </div>

      {conflicted.length > 0 && (
        <div className="file-group">
          <div className="file-group-head conflict">
            <TriangleAlert size={14} />
            <span>Conflitti ({conflicted.length})</span>
          </div>
          {conflicted.map((c) => (
            <div
              key={c.path}
              className={`file-row${view.kind === "conflict" && view.file === c.path ? " active" : ""}`}
              onClick={() => useStore.getState().patchRepo(path, { view: { kind: "conflict", file: c.path } })}
              title={CONFLICT_LABEL[c.kind] ?? c.kind}
            >
              <span className="fstatus fstatus-U">!</span>
              <FileName path={c.path} />
              <span className="file-actions">
                <button className="btn btn-xs" onClick={(e) => { e.stopPropagation(); A.run("Risolvi", () => api.conflictTake(path, c.path, "ours"), { path }); }}>
                  Nostro
                </button>
                <button className="btn btn-xs" onClick={(e) => { e.stopPropagation(); A.run("Risolvi", () => api.conflictTake(path, c.path, "theirs"), { path }); }}>
                  Loro
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="file-group grow-1">
        <div className="file-group-head">
          <span>Non in stage ({unstaged.length})</span>
          {unstaged.length > 0 && (
            <button className="btn btn-xs btn-ok" onClick={() => A.run("Stage", () => api.stageAll(path), { path })}>
              Stage di tutto
            </button>
          )}
        </div>
        <div className="file-list">
          {unstaged.map((f) => (
            <div key={"u" + f.path} className={`file-row${isOpen(f, false) ? " active" : ""}`} onClick={() => openDiff(f, false)}>
              <StatusBadge status={f.status} />
              <FileName path={f.path} />
              <span className="file-actions">
                <button className="icon-btn danger" title="Scarta" onClick={(e) => { e.stopPropagation(); A.discardFiles(path, [f]); }}>
                  <Undo2 size={13} />
                </button>
                <button className="btn btn-xs btn-ok" onClick={(e) => { e.stopPropagation(); stage([f]); }}>
                  <Plus size={12} /> Stage
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="file-group grow-1">
        <div className="file-group-head">
          <span>In stage ({staged.length})</span>
          {staged.length > 0 && (
            <button className="btn btn-xs" onClick={() => A.run("Unstage", () => api.unstageAll(path), { path })}>
              Togli tutto
            </button>
          )}
        </div>
        <div className="file-list">
          {staged.map((f) => (
            <div key={"s" + f.path} className={`file-row${isOpen(f, true) ? " active" : ""}`} onClick={() => openDiff(f, true)}>
              <StatusBadge status={f.status} />
              <FileName path={f.path} oldPath={f.oldPath} />
              <span className="file-actions">
                <button className="btn btn-xs" onClick={(e) => { e.stopPropagation(); unstage([f]); }}>
                  <Minus size={12} /> Unstage
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="commit-box">
        <div className="commit-summary">
          <input
            ref={summaryRef}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Sommario del commit"
            onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && doCommit()}
          />
          <span className={`counter${summary.length > 72 ? " over" : ""}`}>{72 - summary.length}</span>
        </div>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Descrizione (facoltativa)"
          rows={4}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && doCommit()}
        />
        <label className="check small">
          <input type="checkbox" checked={amend} onChange={(e) => onAmend(e.target.checked)} disabled={!o?.head.hash} />
          <span>Modifica l'ultimo commit (amend)</span>
        </label>
        <button className="btn btn-primary btn-block" disabled={!canCommit} onClick={doCommit} title="Ctrl+Invio">
          <GitCommitHorizontal size={15} />
          {amend ? "Amend del commit" : staged.length ? `Commit di ${staged.length} file${branch ? " su " + branch : ""}` : "Metti in stage dei file per il commit"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- commit

function CommitPanel({ tab, hash }: { tab: RepoTab; hash: string }) {
  const path = tab.path;
  const [d, setD] = useState<CommitDetails | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api
      .commitDetails(path, hash)
      .then((x) => alive && setD(x))
      .catch((e) => alive && setErr(errorText(e)));
    return () => {
      alive = false;
    };
  }, [path, hash]);

  if (err) return <div className="panel"><div className="empty error-text">{err}</div></div>;
  if (!d || d.hash !== hash) return <div className="panel"><div className="empty muted">Caricamento…</div></div>;

  const o = tab.overview;
  const view = tab.view;
  const refs = tab.graph?.rows.find((r) => r.hash === hash)?.refs ?? [];
  const sameCommitter = d.committerEmail === d.email && d.committer === d.author;
  const webBase = o?.provider && o.provider.kind !== "unknown" ? o.provider : null;

  return (
    <div className="panel commit-panel">
      <div className="panel-head">
        <button className="sha-btn mono" title="Copia SHA completo" onClick={() => A.copy(d.hash)}>
          <GitCommitHorizontal size={14} /> {d.hash.slice(0, 10)} <Copy size={12} />
        </button>
        {webBase && (
          <button
            className="icon-btn"
            title="Apri sul web"
            onClick={() => A.openExternal(`${webBase.webUrl}/${webBase.kind === "gitlab" ? "-/commit" : "commit"}/${d.hash}`)}
          >
            <ExternalLink size={14} />
          </button>
        )}
      </div>
      <div className="commit-meta">
        <h3 className="commit-subject">{d.subject}</h3>
        {d.body && <pre className="commit-body">{d.body}</pre>}
        {refs.length > 0 && (
          <div className="commit-refs">
            {refs.map((r) => (
              <span key={r.kind + r.name} className={`chip chip-${r.kind}${r.current ? " current" : ""}`}>
                {r.current && <Check size={11} />} {r.name}
              </span>
            ))}
          </div>
        )}
        <div className="person">
          <span className="avatar" style={{ background: personColor(d.email || d.author) }}>
            {initials(d.author)}
          </span>
          <div>
            <div>
              <strong>{d.author}</strong> <span className="muted">&lt;{d.email}&gt;</span>
            </div>
            <div className="muted small">scritto il {fullDate(d.authorTime)}</div>
            {!sameCommitter && (
              <div className="muted small">
                commit di {d.committer} il {fullDate(d.commitTime)}
              </div>
            )}
          </div>
        </div>
        {d.parents.length > 0 && (
          <div className="parents small">
            <span className="muted">{d.parents.length > 1 ? "Genitori" : "Genitore"}:</span>
            {d.parents.map((p) => (
              <button key={p} className="link mono" onClick={() => A.selectCommit(path, p)}>
                {p.slice(0, 7)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="file-group grow-1">
        <div className="file-group-head">
          <FileText size={14} />
          <span>{d.files.length} file cambiati{d.parents.length > 1 ? " (rispetto al primo genitore)" : ""}</span>
        </div>
        <div className="file-list">
          {d.files.map((f) => {
            const active = view.kind === "diff" && view.source.kind === "commit" && view.source.hash === hash && view.source.file.path === f.path;
            return (
              <div
                key={f.path}
                className={`file-row${active ? " active" : ""}`}
                onClick={() => useStore.getState().patchRepo(path, { view: { kind: "diff", source: { kind: "commit", hash, file: f } } })}
              >
                <StatusBadge status={f.status} />
                <FileName path={f.path} oldPath={f.oldPath} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
