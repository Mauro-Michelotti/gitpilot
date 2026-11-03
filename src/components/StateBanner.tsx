import { Play, SkipForward, TriangleAlert, X } from "lucide-react";
import * as A from "../actions";
import { useStore, type RepoTab } from "../store";

const NAMES: Record<string, string> = {
  merge: "Merge in corso",
  rebase: "Rebase in corso",
  "cherry-pick": "Cherry-pick in corso",
  revert: "Revert in corso",
  bisect: "Bisect in corso",
};

export function StateBanner({ tab }: { tab: RepoTab }) {
  const busy = useStore((s) => s.busy);
  const st = tab.overview?.state;
  const conflicts = tab.status?.conflicted.length ?? 0;
  if (!st || (st.kind === "none" && conflicts === 0)) return null;
  const path = tab.path;
  const active = st.kind !== "none" && st.kind !== "bisect";

  return (
    <div className={`state-banner${conflicts ? " has-conflicts" : ""}`}>
      <TriangleAlert size={16} />
      <span>
        <strong>{NAMES[st.kind] ?? "Conflitti"}</strong>
        {st.detail && <span className="muted"> · {st.detail}</span>}
        {conflicts > 0 ? (
          <span>
            {" "}
            — {conflicts} file in conflitto: aprili dal pannello a destra per risolverli
          </span>
        ) : active ? (
          <span> — conflitti risolti, puoi continuare</span>
        ) : null}
      </span>
      <span className="grow" />
      {active && (
        <>
          <button className="btn btn-sm btn-primary" disabled={!!busy || conflicts > 0} onClick={() => A.continueOp(path)}>
            <Play size={13} /> Continua
          </button>
          {st.kind !== "merge" && (
            <button className="btn btn-sm" disabled={!!busy} onClick={() => A.skipOp(path)}>
              <SkipForward size={13} /> Salta commit
            </button>
          )}
          <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => A.abortOp(path)}>
            <X size={13} /> Annulla {st.kind}
          </button>
        </>
      )}
    </div>
  );
}
