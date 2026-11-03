import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, TriangleAlert, X } from "lucide-react";
import * as A from "../actions";
import { api, errorText } from "../api";
import { useStore, type RepoTab } from "../store";
import type { ConflictDoc, Segment } from "../types";
import { CONFLICT_LABEL } from "../util";

type Choice = "ours" | "theirs" | "ours-theirs" | "theirs-ours";

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
          <button className="icon-btn" onClick={close}><X size={16} /></button>
        </div>
        <div className="empty error-text">{err}</div>
      </div>
    );
  }
  if (!doc) return <div className="conflict-view"><div className="empty muted">Caricamento…</div></div>;

  const take = (side: "ours" | "theirs" | "delete") =>
    A.run("Risolvi conflitto", () => api.conflictTake(path, file, side), { path, success: `${file} risolto` });

  const save = async () => {
    if (/^<{7}( |$)/m.test(output) && /^>{7}( |$)/m.test(output)) {
      const ok = await A.confirm("Marcatori ancora presenti", "Il risultato contiene ancora marcatori di conflitto. Salvare comunque?", { confirmLabel: "Salva", danger: true });
      if (!ok) return;
    }
    await A.run("Risolvi conflitto", () => api.conflictResolve(path, file, output), { path, success: `${file} risolto e messo in stage` });
  };

  const deletion = !doc.oursExists || !doc.theirsExists;

  return (
    <div className="conflict-view">
      <div className="diff-head">
        <div className="diff-title">
          <TriangleAlert size={15} className="warn" />
          <span className="mono">{file}</span>
          <span className="muted small">{CONFLICT_LABEL[doc.kind] ?? doc.kind}</span>
        </div>
        <div className="diff-tools">
          {!deletion && (
            <>
              <button className="btn btn-sm" onClick={() => take("ours")}>Tutto da {doc.oursName}</button>
              <button className="btn btn-sm" onClick={() => take("theirs")}>Tutto da {doc.theirsName}</button>
            </>
          )}
          <button className="icon-btn" onClick={close} title="Chiudi">
            <X size={16} />
          </button>
        </div>
      </div>

      {deletion || doc.binary ? (
        <div className="conflict-special">
          <p>
            {doc.binary
              ? "File binario in conflitto: scegli quale versione tenere."
              : !doc.oursExists
                ? `Il file è stato eliminato da ${doc.oursName} e modificato da ${doc.theirsName}.`
                : `Il file è stato modificato da ${doc.oursName} ed eliminato da ${doc.theirsName}.`}
          </p>
          <div className="row-gap">
            {doc.oursExists && <button className="btn" onClick={() => take("ours")}>Tieni la versione di {doc.oursName}</button>}
            {doc.theirsExists && <button className="btn" onClick={() => take("theirs")}>Tieni la versione di {doc.theirsName}</button>}
            {deletion && <button className="btn btn-danger" onClick={() => take("delete")}>Elimina il file</button>}
          </div>
        </div>
      ) : (
        <>
          <div className="conflict-list">
            {conflicts.length === 0 && (
              <div className="empty muted">
                Nessun marcatore di conflitto nel file: probabilmente è già stato sistemato a mano. Salva per segnarlo come risolto.
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
                    <span>Conflitto {i + 1} di {conflicts.length}</span>
                    {ch && <Check size={14} className="ok" />}
                    <span className="grow" />
                    <button className={`btn btn-xs${ch === "ours-theirs" ? " on" : ""}`} onClick={() => pick("ours-theirs")}>Entrambi (prima nostro)</button>
                    <button className={`btn btn-xs${ch === "theirs-ours" ? " on" : ""}`} onClick={() => pick("theirs-ours")}>Entrambi (prima loro)</button>
                  </div>
                  <div className="conflict-sides">
                    <div className={`side ours${ch === "ours" ? " picked" : ""}`} onClick={() => pick("ours")}>
                      <div className="side-label">
                        <input type="checkbox" readOnly checked={ch === "ours" || ch === "ours-theirs" || ch === "theirs-ours"} />
                        {doc.oursName} <span className="muted">(nostro)</span>
                      </div>
                      <pre>{c.ours || <span className="muted">(vuoto)</span>}</pre>
                    </div>
                    <div className={`side theirs${ch === "theirs" ? " picked" : ""}`} onClick={() => pick("theirs")}>
                      <div className="side-label">
                        <input type="checkbox" readOnly checked={ch === "theirs" || ch === "ours-theirs" || ch === "theirs-ours"} />
                        {doc.theirsName} <span className="muted">(loro)</span>
                      </div>
                      <pre>{c.theirs || <span className="muted">(vuoto)</span>}</pre>
                    </div>
                  </div>
                  {c.base !== null && (
                    <details className="base">
                      <summary>Versione originale (base comune)</summary>
                      <pre>{c.base || "(vuoto)"}</pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
          <div className="conflict-output">
            <div className="conflict-output-head">
              <strong>Risultato</strong>
              <span className="muted small">
                {manual !== null ? "modificato a mano" : `${resolvedCount}/${conflicts.length} conflitti scelti`} · puoi modificarlo direttamente
              </span>
              <span className="grow" />
              {manual !== null && (
                <button className="btn btn-xs" onClick={() => setManual(null)}>
                  <RotateCcw size={12} /> Ripristina
                </button>
              )}
              <button className="btn btn-sm btn-primary" onClick={save}>
                <Check size={14} /> Salva e segna risolto
              </button>
            </div>
            <textarea className="mono" spellCheck={false} value={output} onChange={(e) => setManual(e.target.value)} />
          </div>
        </>
      )}
    </div>
  );
}
