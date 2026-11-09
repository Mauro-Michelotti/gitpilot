import { useCallback, useEffect, useState } from "react";
import * as A from "./actions";
import { useT } from "./i18n";
import { useActiveRepo, useStore, type RepoTab } from "./store";
import { ConflictView } from "./components/ConflictView";
import { DetailPanel } from "./components/DetailPanel";
import { CloneDialog, PreferencesDialog } from "./components/Dialogs";
import { DiffView } from "./components/DiffView";
import { Graph } from "./components/Graph";
import { Home } from "./components/Home";
import { ContextMenu, PromptDialog, Toasts } from "./components/Overlays";
import { Sidebar } from "./components/Sidebar";
import { StateBanner } from "./components/StateBanner";
import { TabBar, Toolbar } from "./components/Toolbar";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Width kept in state while dragging; written to localStorage only via `persist` (on drag end). */
function usePersistedWidth(key: string, initial: number, min: number, max: number) {
  const [w, setW] = useState(() => {
    try {
      return clamp(Number(localStorage.getItem(key)) || initial, min, max);
    } catch {
      return initial;
    }
  });
  const persist = useCallback(
    (v: number) => {
      try {
        localStorage.setItem(key, String(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [w, setW, persist] as const;
}

/**
 * Vertical drag handle. The new width is computed from the width and pointer position
 * captured at drag start (total delta), so it never depends on a stale render closure.
 * `side` is the panel the handle resizes: dragging right grows a left panel and shrinks a right one.
 */
function Splitter({
  width,
  min,
  max,
  side,
  onResize,
  onCommit,
}: {
  width: number;
  min: number;
  max: number;
  side: "left" | "right";
  onResize: (w: number) => void;
  onCommit: (w: number) => void;
}) {
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        const startX = e.clientX;
        const startW = width;
        const sign = side === "left" ? 1 : -1;
        let w = startW;
        el.setPointerCapture(e.pointerId);
        document.body.classList.add("resizing");
        const move = (ev: PointerEvent) => {
          w = clamp(startW + sign * (ev.clientX - startX), min, max);
          onResize(w);
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          document.body.classList.remove("resizing");
          if (w !== startW) onCommit(w);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
    />
  );
}

const LEFT_MIN = 180;
const LEFT_MAX = 520;
const RIGHT_MIN = 280;
const RIGHT_MAX = 700;

function RepoScreen({ tab }: { tab: RepoTab }) {
  const t = useT();
  const [left, setLeft, saveLeft] = usePersistedWidth("gp.leftW", 260, LEFT_MIN, LEFT_MAX);
  const [right, setRight, saveRight] = usePersistedWidth("gp.rightW", 380, RIGHT_MIN, RIGHT_MAX);
  const view = tab.view;

  if (tab.error && !tab.overview) {
    return (
      <div className="empty big">
        <p className="error-text">{tab.error}</p>
        <button className="btn" onClick={() => A.closeTab(tab.path)}>
          {t("app.closeTab")}
        </button>
      </div>
    );
  }

  return (
    <>
      <Toolbar tab={tab} />
      <StateBanner tab={tab} />
      <div className="workspace" style={{ gridTemplateColumns: `${left}px 4px 1fr 4px ${right}px` }}>
        <Sidebar tab={tab} />
        <Splitter width={left} min={LEFT_MIN} max={LEFT_MAX} side="left" onResize={setLeft} onCommit={saveLeft} />
        <main className="center">
          {view.kind === "diff" ? (
            <DiffView tab={tab} source={view.source} />
          ) : view.kind === "conflict" ? (
            <ConflictView tab={tab} file={view.file} />
          ) : (
            <Graph tab={tab} />
          )}
        </main>
        <Splitter width={right} min={RIGHT_MIN} max={RIGHT_MAX} side="right" onResize={setRight} onCommit={saveRight} />
        <DetailPanel tab={tab} />
      </div>
    </>
  );
}

function StatusBar() {
  const tab = useActiveRepo();
  const progress = useStore((s) => s.progress);
  const busy = useStore((s) => s.busy);
  const info = useStore((s) => s.info);
  return (
    <footer className="statusbar">
      {busy && progress ? <span className="mono">{progress}</span> : tab?.error ? <span className="error-text">{tab.error}</span> : <span>{tab?.path ?? ""}</span>}
      <span className="grow" />
      {tab?.overview?.gitflow && <span className="muted">Git Flow</span>}
      <span className="muted">{info?.gitVersion}</span>
    </footer>
  );
}

export default function App() {
  const tab = useActiveRepo();
  const modal = useStore((s) => s.modal);

  useEffect(() => {
    A.boot().catch((e) => A.toast("error", String(e)));
  }, []);

  useEffect(() => {
    let zoom = 1;
    try {
      zoom = Number(localStorage.getItem("gp.zoom")) || 1;
    } catch {
      /* ignore */
    }
    const apply = () => {
      (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(zoom);
      try {
        localStorage.setItem("gp.zoom", String(zoom));
      } catch {
        /* ignore */
      }
    };
    apply();
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const st = useStore.getState();
      if (e.key === "F5" || (mod && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        if (st.active) A.reload(st.active);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        A.pickAndOpenRepo();
      } else if (mod && e.key.toLowerCase() === "w" && st.active) {
        e.preventDefault();
        A.closeTab(st.active);
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoom = Math.min(2, +(zoom + 0.1).toFixed(2));
        apply();
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoom = Math.max(0.6, +(zoom - 0.1).toFixed(2));
        apply();
      } else if (mod && e.key === "0") {
        e.preventDefault();
        zoom = 1;
        apply();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="app"
      onContextMenu={(e) => {
        // Keep the native menu (copy/paste) in text fields only.
        const t = e.target as HTMLElement;
        if (!t.closest("input, textarea, pre, .selectable")) e.preventDefault();
      }}
    >
      <TabBar />
      <div className="screen">{tab ? <RepoScreen key={tab.path} tab={tab} /> : <Home />}</div>
      <StatusBar />
      <ContextMenu />
      <PromptDialog />
      {modal === "clone" && <CloneDialog />}
      {modal === "preferences" && <PreferencesDialog />}
      <Toasts />
    </div>
  );
}
