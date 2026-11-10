import { CloudDownload, FolderGit2, FolderOpen, FolderPlus, Settings as Gear, Layers, X } from "lucide-react";
import * as A from "../actions";
import { api } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { basename, relativeTime } from "../util";
import { Logo, ProviderIcon } from "./icons";

export function Home() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const accounts = useStore((s) => s.accounts);
  const info = useStore((s) => s.info);
  const set = useStore((s) => s.set);
  const recent = settings?.recent ?? [];
  const groups = settings?.groups ?? [];
  const groupOf = (path: string) => groups.find((g) => g.repos.includes(path));

  const initRepo = async () => {
    const v = await A.prompt({
      title: t("home.new.title"),
      fields: [
        { name: "parent", label: t("home.new.parent"), type: "folder", value: settings?.cloneDir ?? info?.homeDir ?? "", required: true, mono: true },
        { name: "name", label: t("home.new.name"), placeholder: t("home.new.namePlaceholder"), required: true, mono: true },
        { name: "branch", label: t("home.new.branch"), value: "main", mono: true },
        { name: "gitflow", label: t("home.new.gitflow"), type: "checkbox", value: false },
      ],
      confirmLabel: t("home.new.create"),
    });
    if (!v) return;
    const dest = `${String(v.parent).replace(/[\\/]+$/, "")}/${String(v.name).trim()}`;
    const root = await A.run(t("home.new.busy"), () => api.repoInit(dest, String(v.branch || "main")), { path: null });
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
            <strong>{t("home.open")}</strong>
            <span className="muted">{t("home.open.hint")}</span>
          </button>
          <button className="home-card" onClick={() => set({ modal: "clone" })}>
            <CloudDownload size={22} />
            <strong>{t("home.clone")}</strong>
            <span className="muted">{t("home.clone.hint")}</span>
          </button>
          <button className="home-card" onClick={initRepo}>
            <FolderPlus size={22} />
            <strong>{t("home.create")}</strong>
            <span className="muted">{t("home.create.hint")}</span>
          </button>
        </div>

        <div className="home-cols">
          <div className="home-recent">
            <h3>{t("home.recent")}</h3>
            {recent.length === 0 && groups.length === 0 && <p className="muted">{t("home.recent.empty")}</p>}
            {groups.map((g) => (
              <div key={g.id} className="recent-row" onClick={() => A.openGroup(g.id)} title={g.repos.join("\n")}>
                <Layers size={16} className="accent" />
                <div className="recent-text">
                  <span>{g.name}</span>
                  <span className="muted small">{g.repos.map(basename).join(", ")}</span>
                </div>
                <span className="muted small">{t("groups.count", { count: g.repos.length })}</span>
                <button
                  className="icon-btn"
                  title={t("groups.home.remove")}
                  onClick={(e) => {
                    e.stopPropagation();
                    A.dissolveGroup(g.id);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {recent.map((r) => (
              <div key={r.path} className="recent-row" onClick={() => A.openRepo(r.path)} title={r.path}>
                <FolderGit2 size={16} className="muted" />
                <div className="recent-text">
                  <span>{r.name}</span>
                  <span className="muted small">{r.path}</span>
                </div>
                {groupOf(r.path) && (
                  <span className="recent-group">
                    <Layers size={11} />
                    {groupOf(r.path)!.name}
                  </span>
                )}
                <span className="muted small">{relativeTime(r.lastOpened)}</span>
                <button
                  className="icon-btn"
                  title={t("home.recent.remove")}
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
            <h3>{t("home.accounts")}</h3>
            {accounts.length === 0 && <p className="muted">{t("home.accounts.empty")}</p>}
            {accounts.map((a) => (
              <div key={a.id} className="account-row">
                <ProviderIcon kind={a.kind} />
                <span>{a.name ?? a.username}</span>
                <span className="muted small">{a.host}</span>
              </div>
            ))}
            <button className="btn" onClick={() => set({ modal: "preferences" })}>
              <Gear size={14} /> {t("home.accounts.manage")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
