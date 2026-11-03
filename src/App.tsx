import { useCallback, useEffect, useRef, useState } from "react";
import * as A from "./actions";
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

function usePersistedWidth(key: string, initial: number) {
  const [w, setW] = useState(() => {
    try {
      return Number(localStorage.getItem(key)) || initial;
    } catch {
      return initial;
    }
  });
  const save = useCallback(
    (v: number) => {
      setW(v);
      try {
        localStorage.setItem(key, String(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [w, save] as const;
}

function Splitter({ onDrag }: { onDrag: (dx: number) => void }) {
  const last = useRef(0);
  return (
    <div
      className="splitter"
      onMouseDown={(e) => {
        last.current = e.clientX;
        const move = (ev: MouseEvent) => {
          onDrag(ev.clientX - last.current);
          last.current = ev.clientX;
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          document.body.classList.remove("resizing");
        };
        document.body.classList.add("resizing");
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
  );
}

function RepoScreen({ tab }: { tab: RepoTab }) {
  const [left, setLeft] = usePersistedWidth("gp.leftW", 260);
  const [right, setRight] = usePersistedWidth("gp.rightW", 380);
  const view = tab.view;

  if (tab.error && !tab.overview) {
    return (
      <div className="empty big">
        <p className="error-text">{tab.error}</p>
        <button className="btn" onClick={() => A.closeTab(tab.path)}>
          Chiudi scheda
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
        <Splitter onDrag={(dx) => setLeft(Math.max(180, Math.min(520, left + dx)))} />
        <main className="center">
          {view.kind === "diff" ? (
            <DiffView tab={tab} source={view.source} />
          ) : view.kind === "conflict" ? (
            <ConflictView tab={tab} file={view.file} />
          ) : (
            <Graph tab={tab} />
          )}
        </main>
        <Splitter onDrag={(dx) => setRight(Math.max(280, Math.min(700, right - dx)))} />
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
        if (st.active) A.refresh(st.active, { full: true });
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
