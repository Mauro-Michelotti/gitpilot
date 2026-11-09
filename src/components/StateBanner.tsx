import { Play, SkipForward, TriangleAlert, X } from "lucide-react";
import * as A from "../actions";
import { useT, type MsgKey } from "../i18n";
import { useStore, type RepoTab } from "../store";

const NAMES: Record<string, MsgKey> = {
  merge: "banner.merge",
  rebase: "banner.rebase",
  "cherry-pick": "banner.cherry-pick",
  revert: "banner.revert",
  bisect: "banner.bisect",
};

export function StateBanner({ tab }: { tab: RepoTab }) {
  const t = useT();
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
        <strong>{t(NAMES[st.kind] ?? "banner.conflicts")}</strong>
        {st.detail && <span className="muted"> · {st.detail}</span>}
        {conflicts > 0 ? (
          <span>
            {" "}
            — {t("banner.conflictedFiles", { count: conflicts })}
          </span>
        ) : active ? (
          <span> — {t("banner.resolved")}</span>
        ) : null}
      </span>
      <span className="grow" />
      {active && (
        <>
          <button className="btn btn-sm btn-primary" disabled={!!busy || conflicts > 0} onClick={() => A.continueOp(path)}>
            <Play size={13} /> {t("banner.continue")}
          </button>
          {st.kind !== "merge" && (
            <button className="btn btn-sm" disabled={!!busy} onClick={() => A.skipOp(path)}>
              <SkipForward size={13} /> {t("banner.skip")}
            </button>
          )}
          <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => A.abortOp(path)}>
            <X size={13} /> {t("banner.abort", { kind: st.kind })}
          </button>
        </>
      )}
    </div>
  );
}
