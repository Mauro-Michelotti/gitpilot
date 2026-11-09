import { useEffect, useState } from "react";
import { Columns2, Minus, Plus, Rows2, Undo2, X } from "lucide-react";
import * as A from "../actions";
import { api, errorText } from "../api";
import { useT } from "../i18n";
import { useStore, type DiffSource, type RepoTab } from "../store";
import type { DiffLine, FileDiff, Hunk } from "../types";

type Mode = "unified" | "split";

function loadMode(): Mode {
  try {
    return localStorage.getItem("gp.diffMode") === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

export function DiffView({ tab, source }: { tab: RepoTab; source: DiffSource }) {
  const t = useT();
  const path = tab.path;
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(loadMode);
  const file = source.file;
  const untracked = file.status === "?";
  const key = source.kind === "commit" ? `c:${source.hash}:${file.path}` : `w:${source.staged}:${file.path}`;
  // Working-copy diffs reload after every refresh; commit diffs are immutable.
  const rev = source.kind === "working" ? tab.revision : 0;

  useEffect(() => {
    let alive = true;
    setErr(null);
    const p =
      source.kind === "commit"
        ? api.diffCommit(path, source.hash, file.path, file.oldPath)
        : api.diffWorking(path, file.path, source.staged ? file.oldPath : null, source.staged, untracked && !source.staged);
    p.then((d) => alive && setDiff(d)).catch((e) => alive && setErr(errorText(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, rev]);

  const close = () => useStore.getState().patchRepo(path, { view: { kind: "graph" } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useStore.getState().prompt && !useStore.getState().menu) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const switchMode = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem("gp.diffMode", m);
    } catch {
      /* ignore */
    }
  };

  const hunkAction = (h: Hunk, action: "stage" | "unstage" | "discard") => {
    const run = () =>
      A.run(action === "stage" ? "Stage hunk" : action === "unstage" ? "Unstage hunk" : t("diff.discardHunkBusy"), () =>
        api.applyHunk(path, file.path, source.kind === "working" && source.staged ? file.oldPath : null, h.header, action),
      { path });
    if (action === "discard") {
      A.confirm(t("diff.discardTitle"), t("diff.discardConfirm"), { danger: true, confirmLabel: t("diff.discard") }).then((ok) => {
        if (ok) run();
      });
    } else run();
  };

  const canHunk = source.kind === "working" && !untracked && !!diff && !diff.binary;
  const subtitle =
    source.kind === "commit"
      ? `commit ${source.hash.slice(0, 7)}`
      : source.staged
        ? t("diff.subtitle.staged")
        : untracked
          ? t("diff.subtitle.untracked")
          : t("diff.subtitle.unstaged");

  return (
    <div className="diff-view">
      <div className="diff-head">
        <div className="diff-title">
          <span className="mono">{file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}</span>
          <span className="muted small">{subtitle}</span>
          {diff && (
            <span className="diff-stats">
              <span className="add">+{diff.added}</span> <span className="del">−{diff.removed}</span>
            </span>
          )}
        </div>
        <div className="diff-tools">
          {source.kind === "working" && (
            source.staged ? (
              <button className="btn btn-sm" onClick={() => A.run("Unstage", () => api.unstage(path, file.oldPath ? [file.path, file.oldPath] : [file.path]), { path }).then(close)}>
                <Minus size={13} /> Unstage file
              </button>
            ) : (
              <button className="btn btn-sm btn-ok" onClick={() => A.run("Stage", () => api.stage(path, [file.path]), { path }).then(close)}>
                <Plus size={13} /> Stage file
              </button>
            )
          )}
          <div className="seg">
            <button className={mode === "unified" ? "on" : ""} onClick={() => switchMode("unified")} title={t("diff.unified")}>
              <Rows2 size={14} />
            </button>
            <button className={mode === "split" ? "on" : ""} onClick={() => switchMode("split")} title={t("diff.split")}>
              <Columns2 size={14} />
            </button>
          </div>
          <button className="icon-btn" onClick={close} title={t("diff.close")}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="diff-body">
        {err && <div className="empty error-text">{err}</div>}
        {!err && !diff && <div className="empty muted">{t("diff.loading")}</div>}
        {diff?.binary && <div className="empty muted">{t("diff.binary")}</div>}
        {diff && !diff.binary && diff.hunks.length === 0 && <div className="empty muted">{t("diff.noContent")}</div>}
        {diff?.hunks.map((h) => (
          <div key={h.header} className="hunk">
            <div className="hunk-head">
              <span className="mono">{h.header}</span>
              {canHunk && (
                <span className="hunk-actions">
                  {source.kind === "working" && !source.staged && (
                    <>
                      <button className="btn btn-xs danger-ghost" onClick={() => hunkAction(h, "discard")}>
                        <Undo2 size={12} /> {t("diff.discard")}
                      </button>
                      <button className="btn btn-xs btn-ok" onClick={() => hunkAction(h, "stage")}>
                        <Plus size={12} /> {t("diff.stageHunk")}
                      </button>
                    </>
                  )}
                  {source.kind === "working" && source.staged && (
                    <button className="btn btn-xs" onClick={() => hunkAction(h, "unstage")}>
                      <Minus size={12} /> {t("diff.unstageHunk")}
                    </button>
                  )}
                </span>
              )}
            </div>
            {mode === "unified" ? <Unified lines={h.lines} /> : <Split lines={h.lines} />}
          </div>
        ))}
        {diff?.truncated && <div className="empty muted">{t("diff.truncated")}</div>}
      </div>
    </div>
  );
}

const cls = (k: string) => (k === "+" ? "add" : k === "-" ? "del" : k === "\\" ? "note" : "ctx");

function Unified({ lines }: { lines: DiffLine[] }) {
  return (
    <table className="diff-table">
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className={cls(l.kind)}>
            <td className="ln">{l.oldNo ?? ""}</td>
            <td className="ln">{l.newNo ?? ""}</td>
            <td className="sign">{l.kind === "\\" ? "" : l.kind}</td>
            <td className="code">{l.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Pair = { left: DiffLine | null; right: DiffLine | null };

function pairLines(lines: DiffLine[]): Pair[] {
  const out: Pair[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === "-" || l.kind === "+") {
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "-") dels.push(lines[i++]);
      while (i < lines.length && lines[i].kind === "+") adds.push(lines[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    } else if (l.kind === "\\") {
      i++;
    } else {
      out.push({ left: l, right: l });
      i++;
    }
  }
  return out;
}

function Split({ lines }: { lines: DiffLine[] }) {
  return (
    <table className="diff-table split">
      <tbody>
        {pairLines(lines).map((p, i) => (
          <tr key={i}>
            <td className={`ln ${p.left ? cls(p.left.kind) : "empty"}`}>{p.left?.oldNo ?? ""}</td>
            <td className={`code half ${p.left ? cls(p.left.kind) : "empty"}`}>{p.left?.text ?? ""}</td>
            <td className={`ln ${p.right ? cls(p.right.kind) : "empty"}`}>{p.right?.newNo ?? ""}</td>
            <td className={`code half ${p.right ? cls(p.right.kind) : "empty"}`}>{p.right?.text ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
