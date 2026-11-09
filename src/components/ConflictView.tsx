import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, TriangleAlert, X } from "lucide-react";
import * as A from "../actions";
import { api, errorText } from "../api";
import { t as tr, useT, type MsgKey } from "../i18n";
import { useStore, type RepoTab } from "../store";
import type { ConflictDoc, Segment } from "../types";

type Choice = "ours" | "theirs" | "ours-theirs" | "theirs-ours";

const CONFLICT_KIND: Record<string, MsgKey> = {
  "both-modified": "conflict.kind.both-modified",
  "both-added": "conflict.kind.both-added",
  "both-deleted": "conflict.kind.both-deleted",
  "added-by-us": "conflict.kind.added-by-us",
  "added-by-them": "conflict.kind.added-by-them",
  "deleted-by-us": "conflict.kind.deleted-by-us",
  "deleted-by-them": "conflict.kind.deleted-by-them",
};

/** Description of a conflict kind ("both-modified"…) in the active language; call it from a component using `useT()`. */
export const conflictKindLabel = (kind: string) => (CONFLICT_KIND[kind] ? tr(CONFLICT_KIND[kind]) : kind);

function buildOutput(segments: Segment[], choices: Record<number, Choice | undefined>) {
  let ci = 0;
  return segments
    .map((s) => {
      if (s.type === "common") return s.text;
      const c = choices[ci++];
      const nl = (t: string) => (t && !t.endsWith("\n") ? t + "\n" : t);
      switch (c) {
        case "ours":
          return s.ours;
        case "theirs":
          return s.theirs;
        case "ours-theirs":
          return nl(s.ours) + s.theirs;
        case "theirs-ours":
          return nl(s.theirs) + s.ours;
        default:
          return `<<<<<<< ${s.oursLabel}\n${nl(s.ours)}=======\n${nl(s.theirs)}>>>>>>> ${s.theirsLabel}\n`;
      }
    })
    .join("");
}

export function ConflictView({ tab, file }: { tab: RepoTab; file: string }) {
  const t = useT();
  const path = tab.path;
  const [doc, setDoc] = useState<ConflictDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice | undefined>>({});
  const [manual, setManual] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDoc(null);
    setErr(null);
    setChoices({});
    setManual(null);
    api
      .conflictLoad(path, file)
      .then((d) => alive && setDoc(d))
      .catch((e) => alive && setErr(errorText(e)));
    return () => {
      alive = false;
    };
  }, [path, file]);

  const close = () => useStore.getState().patchRepo(path, { view: { kind: "graph" } });
  const conflicts = useMemo(() => (doc?.segments ?? []).filter((s) => s.type === "conflict") as Extract<Segment, { type: "conflict" }>[], [doc]);
  const output = useMemo(() => manual ?? (doc ? buildOutput(doc.segments, choices) : ""), [doc, choices, manual]);
  const resolvedCount = conflicts.filter((_, i) => choices[i]).length;

  if (err) {
    return (
      <div className="conflict-view">
        <div className="diff-head">
          <span className="mono">{file}</span>
          <button className="icon-btn" onClick={close} title={t("common.close")}><X size={16} /></button>
        </div>
        <div className="empty error-text">{err}</div>
      </div>
    );
  }
  if (!doc) return <div className="conflict-view"><div className="empty muted">{t("conflict.loading")}</div></div>;

  const take = (side: "ours" | "theirs" | "delete") =>
    A.run(t("conflict.resolveBusy"), () => api.conflictTake(path, file, side), { path, success: t("conflict.resolved", { file }) });

  const save = async () => {
    if (/^<{7}( |$)/m.test(output) && /^>{7}( |$)/m.test(output)) {
      const ok = await A.confirm(t("conflict.markersTitle"), t("conflict.markersConfirm"), { confirmLabel: t("conflict.save"), danger: true });
      if (!ok) return;
    }
    await A.run(t("conflict.resolveBusy"), () => api.conflictResolve(path, file, output), { path, success: t("conflict.resolvedStaged", { file }) });
  };

  const deletion = !doc.oursExists || !doc.theirsExists;

  return (
    <div className="conflict-view">
      <div className="diff-head">
        <div className="diff-title">
          <TriangleAlert size={15} className="warn" />
          <span className="mono">{file}</span>
          <span className="muted small">{conflictKindLabel(doc.kind)}</span>
        </div>
        <div className="diff-tools">
          {!deletion && (
            <>
              <button className="btn btn-sm" onClick={() => take("ours")}>{t("conflict.takeAll", { name: doc.oursName })}</button>
              <button className="btn btn-sm" onClick={() => take("theirs")}>{t("conflict.takeAll", { name: doc.theirsName })}</button>
            </>
          )}
          <button className="icon-btn" onClick={close} title={t("common.close")}>
            <X size={16} />
          </button>
        </div>
      </div>

      {deletion || doc.binary ? (
        <div className="conflict-special">
          <p>
            {doc.binary
              ? t("conflict.binary")
              : !doc.oursExists
                ? t("conflict.deletedByOurs", { ours: doc.oursName, theirs: doc.theirsName })
                : t("conflict.deletedByTheirs", { ours: doc.oursName, theirs: doc.theirsName })}
          </p>
          <div className="row-gap">
            {doc.oursExists && <button className="btn" onClick={() => take("ours")}>{t("conflict.keep", { name: doc.oursName })}</button>}
            {doc.theirsExists && <button className="btn" onClick={() => take("theirs")}>{t("conflict.keep", { name: doc.theirsName })}</button>}
            {deletion && <button className="btn btn-danger" onClick={() => take("delete")}>{t("conflict.deleteFile")}</button>}
          </div>
        </div>
      ) : (
        <>
          <div className="conflict-list">
            {conflicts.length === 0 && (
              <div className="empty muted">
                {t("conflict.noMarkers")}
              </div>
            )}
            {conflicts.map((c, i) => {
              const ch = choices[i];
              const pick = (v: Choice) => {
                setManual(null);
                setChoices((s) => ({ ...s, [i]: s[i] === v ? undefined : v }));
              };
              return (
                <div key={i} className={`conflict-card${ch ? " done" : ""}`}>
                  <div className="conflict-card-head">
                    <span>{t("conflict.counter", { n: i + 1, total: conflicts.length })}</span>
                    {ch && <Check size={14} className="ok" />}
                    <span className="grow" />
                    <button className={`btn btn-xs${ch === "ours-theirs" ? " on" : ""}`} onClick={() => pick("ours-theirs")}>{t("conflict.bothOursFirst")}</button>
                    <button className={`btn btn-xs${ch === "theirs-ours" ? " on" : ""}`} onClick={() => pick("theirs-ours")}>{t("conflict.bothTheirsFirst")}</button>
                  </div>
                  <div className="conflict-sides">
                    <div className={`side ours${ch === "ours" ? " picked" : ""}`} onClick={() => pick("ours")}>
                      <div className="side-label">
                        <input type="checkbox" readOnly checked={ch === "ours" || ch === "ours-theirs" || ch === "theirs-ours"} />
                        {doc.oursName} <span className="muted">{t("conflict.ours")}</span>
                      </div>
                      <pre>{c.ours || <span className="muted">{t("conflict.empty")}</span>}</pre>
                    </div>
                    <div className={`side theirs${ch === "theirs" ? " picked" : ""}`} onClick={() => pick("theirs")}>
                      <div className="side-label">
                        <input type="checkbox" readOnly checked={ch === "theirs" || ch === "ours-theirs" || ch === "theirs-ours"} />
                        {doc.theirsName} <span className="muted">{t("conflict.theirs")}</span>
                      </div>
                      <pre>{c.theirs || <span className="muted">{t("conflict.empty")}</span>}</pre>
                    </div>
                  </div>
                  {c.base !== null && (
                    <details className="base">
                      <summary>{t("conflict.base")}</summary>
                      <pre>{c.base || t("conflict.empty")}</pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
          <div className="conflict-output">
            <div className="conflict-output-head">
              <strong>{t("conflict.result")}</strong>
              <span className="muted small">
                {manual !== null ? t("conflict.editedByHand") : t("conflict.chosen", { done: resolvedCount, total: conflicts.length })}
                {t("conflict.editable")}
              </span>
              <span className="grow" />
              {manual !== null && (
                <button className="btn btn-xs" onClick={() => setManual(null)}>
                  <RotateCcw size={12} /> {t("conflict.restore")}
                </button>
              )}
              <button className="btn btn-sm btn-primary" onClick={save}>
                <Check size={14} /> {t("conflict.saveResolved")}
              </button>
            </div>
            <textarea className="mono" spellCheck={false} value={output} onChange={(e) => setManual(e.target.value)} />
          </div>
        </>
      )}
    </div>
  );
}
