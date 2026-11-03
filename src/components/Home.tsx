import { CloudDownload, FolderGit2, FolderOpen, FolderPlus, Settings as Gear, X } from "lucide-react";
import * as A from "../actions";
import { api } from "../api";
import { useStore } from "../store";
import { relativeTime } from "../util";
import { Logo, ProviderIcon } from "./icons";

export function Home() {
  const settings = useStore((s) => s.settings);
  const accounts = useStore((s) => s.accounts);
  const info = useStore((s) => s.info);
  const set = useStore((s) => s.set);
  const recent = settings?.recent ?? [];

  const initRepo = async () => {
    const v = await A.prompt({
      title: "Nuovo repository",
      fields: [
        { name: "parent", label: "Cartella che lo conterrà", type: "folder", value: settings?.cloneDir ?? info?.homeDir ?? "", required: true, mono: true },
        { name: "name", label: "Nome", placeholder: "mio-progetto", required: true, mono: true },
        { name: "branch", label: "Branch iniziale", value: "main", mono: true },
        { name: "gitflow", label: "Inizializza anche Git Flow", type: "checkbox", value: false },
      ],
      confirmLabel: "Crea",
    });
    if (!v) return;
    const dest = `${String(v.parent).replace(/[\\/]+$/, "")}/${String(v.name).trim()}`;
    const root = await A.run("Crea repository", () => api.repoInit(dest, String(v.branch || "main")), { path: null });
    if (root) {
      await A.openRepo(root);
      if (v.gitflow) A.gitflowInit(root);
    }
  };

  const removeRecent = (p: string) => A.saveSettings({ recent: recent.filter((r) => r.path !== p) });

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-hero">
          <Logo size={56} />
          <div>
            <h1>GitPilot</h1>
            <p className="muted">
              {info ? `v${info.version} · ${info.gitVersion}` : ""}
            </p>
          </div>
        </div>
        <div className="home-actions">
          <button className="home-card" onClick={A.pickAndOpenRepo}>
            <FolderOpen size={22} />
            <strong>Apri</strong>
            <span className="muted">un repository esistente</span>
          </button>
          <button className="home-card" onClick={() => set({ modal: "clone" })}>
            <CloudDownload size={22} />
            <strong>Clona</strong>
            <span className="muted">da URL, GitHub o GitLab</span>
          </button>
          <button className="home-card" onClick={initRepo}>
            <FolderPlus size={22} />
            <strong>Crea</strong>
            <span className="muted">un nuovo repository</span>
          </button>
        </div>

        <div className="home-cols">
          <div className="home-recent">
            <h3>Recenti</h3>
            {recent.length === 0 && <p className="muted">Nessun repository aperto di recente.</p>}
            {recent.map((r) => (
              <div key={r.path} className="recent-row" onClick={() => A.openRepo(r.path)} title={r.path}>
                <FolderGit2 size={16} className="muted" />
                <div className="recent-text">
                  <span>{r.name}</span>
                  <span className="muted small">{r.path}</span>
                </div>
                <span className="muted small">{relativeTime(r.lastOpened)}</span>
                <button
                  className="icon-btn"
                  title="Rimuovi dai recenti"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRecent(r.path);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="home-accounts">
            <h3>Account</h3>
            {accounts.length === 0 && <p className="muted">Collega GitHub o GitLab per clonare i tuoi repository e gestire pull/merge request.</p>}
            {accounts.map((a) => (
              <div key={a.id} className="account-row">
                <ProviderIcon kind={a.kind} />
                <span>{a.name ?? a.username}</span>
                <span className="muted small">{a.host}</span>
              </div>
            ))}
            <button className="btn" onClick={() => set({ modal: "preferences" })}>
              <Gear size={14} /> Gestisci account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
