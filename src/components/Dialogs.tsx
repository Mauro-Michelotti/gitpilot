import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ExternalLink, FolderOpen, Globe, KeyRound, Lock, RefreshCw, Search, Trash } from "lucide-react";
import * as A from "../actions";
import { api, errorText } from "../api";
import { useStore } from "../store";
import type { RemoteRepo, Settings } from "../types";
import { relativeTime } from "../util";
import { ProviderIcon } from "./icons";
import { Modal } from "./Overlays";

function repoNameFromUrl(url: string) {
  const m = url.trim().replace(/\/+$/, "").match(/([^/:]+?)(\.git)?$/);
  return m ? m[1] : "";
}

export function CloneDialog() {
  const accounts = useStore((s) => s.accounts);
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.info);
  const progress = useStore((s) => s.progress);
  const set = useStore((s) => s.set);
  const [source, setSource] = useState<string>("url");
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(settings?.cloneDir ?? (info?.homeDir ? `${info.homeDir}/Progetti` : ""));
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [repos, setRepos] = useState<Record<string, RemoteRepo[] | string>>({});
  const [q, setQ] = useState("");
  const [ssh, setSsh] = useState(false);
  const [selected, setSelected] = useState<RemoteRepo | null>(null);
  const [cloning, setCloning] = useState(false);
  const close = () => !cloning && set({ modal: null });

  useEffect(() => {
    if (!nameTouched) setName(repoNameFromUrl(url));
  }, [url, nameTouched]);

  const loadRepos = (id: string) => {
    setRepos((r) => ({ ...r, [id]: [] }));
    api
      .providerRepos(id)
      .then((list) => setRepos((r) => ({ ...r, [id]: list })))
      .catch((e) => setRepos((r) => ({ ...r, [id]: errorText(e) })));
  };

  useEffect(() => {
    if (source !== "url" && repos[source] === undefined) loadRepos(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    if (selected) setUrl(ssh ? selected.cloneSsh : selected.cloneHttps);
  }, [selected, ssh]);

  const list = repos[source];
  const filtered = useMemo(
    () => (Array.isArray(list) ? list.filter((r) => !q || r.fullName.toLowerCase().includes(q.toLowerCase())) : []),
    [list, q],
  );

  const dest = parent && name ? `${parent.replace(/[\\/]+$/, "")}/${name}` : "";
  const canClone = !!url.trim() && !!dest && !cloning;

  const doClone = async () => {
    if (!canClone) return;
    setCloning(true);
    const root = await A.run("Clone", () => api.repoClone(Math.random().toString(36).slice(2), url.trim(), dest), {
      path: null,
      success: `Clonato in ${dest}`,
    });
    setCloning(false);
    if (root) {
      A.saveSettings({ cloneDir: parent });
      set({ modal: null });
      await A.openRepo(root);
    }
  };

  return (
    <Modal
      title="Clona repository"
      onClose={close}
      width={760}
      footer={
        <>
          {cloning && <span className="progress-line mono">{progress ?? "Avvio…"}</span>}
          <button className="btn" onClick={close} disabled={cloning}>
            Annulla
          </button>
          <button className="btn btn-primary" disabled={!canClone} onClick={doClone}>
            {cloning ? <RefreshCw size={14} className="spin" /> : null} Clona
          </button>
        </>
      }
    >
      <div className="clone-layout">
        <div className="clone-sources">
          <button className={source === "url" ? "on" : ""} onClick={() => setSource("url")}>
            <Globe size={15} /> URL
          </button>
          {accounts.map((a) => (
            <button key={a.id} className={source === a.id ? "on" : ""} onClick={() => setSource(a.id)} title={a.host}>
              <ProviderIcon kind={a.kind} size={15} /> {a.username}
              <span className="muted small">{a.host}</span>
            </button>
          ))}
          <button className="muted" onClick={() => set({ modal: "preferences" })}>
            + Account
          </button>
        </div>
        <div className="clone-main">
          {source !== "url" && (
            <div className="clone-repos">
              <div className="sb-search">
                <Search size={14} className="muted" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca repository…" />
                <button className="icon-btn" title="Ricarica" onClick={() => loadRepos(source)}>
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="repo-list">
                {typeof list === "string" && <div className="empty error-text">{list}</div>}
                {Array.isArray(list) && list.length === 0 && <div className="empty muted">Caricamento…</div>}
                {filtered.map((r) => (
                  <div
                    key={r.fullName}
                    className={`repo-row${selected?.fullName === r.fullName ? " on" : ""}`}
                    onClick={() => {
                      setSelected(r);
                      setNameTouched(false);
                    }}
                    onDoubleClick={doClone}
                  >
                    {r.private ? <Lock size={13} className="muted" /> : <Globe size={13} className="muted" />}
                    <div className="recent-text">
                      <span>{r.fullName}</span>
                      {r.description && <span className="muted small">{r.description}</span>}
                    </div>
                    {r.updatedAt && <span className="muted small">{relativeTime(Date.parse(r.updatedAt) / 1000)}</span>}
                  </div>
                ))}
              </div>
              <label className="check small">
                <input type="checkbox" checked={ssh} onChange={(e) => setSsh(e.target.checked)} /> Usa SSH invece di HTTPS
              </label>
            </div>
          )}
          <div className="form">
            <label className="field">
              <span className="field-label">URL del repository</span>
              <input
                className="mono"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setSelected(null);
                }}
                placeholder="https://github.com/owner/repo.git oppure git@gitlab.com:group/repo.git"
                spellCheck={false}
                autoFocus={source === "url"}
              />
            </label>
            <label className="field">
              <span className="field-label">Cartella di destinazione</span>
              <div className="input-row">
                <input className="mono" value={parent} onChange={(e) => setParent(e.target.value)} spellCheck={false} />
                <button
                  className="btn"
                  type="button"
                  onClick={async () => {
                    const d = await openDialog({ directory: true, defaultPath: parent || undefined });
                    if (typeof d === "string") setParent(d);
                  }}
                >
                  <FolderOpen size={14} /> Sfoglia
                </button>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Nome cartella</span>
              <input
                className="mono"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                spellCheck={false}
              />
              {dest && <span className="field-help mono">{dest}</span>}
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const TOKEN_HELP = {
  github: {
    url: (base: string) =>
      base.includes("github.com")
        ? "https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=GitPilot"
        : `${base}/settings/tokens/new?scopes=repo,read:org,workflow&description=GitPilot`,
    scopes: "repo, read:org, workflow",
  },
  gitlab: {
    url: (base: string) => `${base}/-/user_settings/personal_access_tokens?name=GitPilot&scopes=api,read_user,write_repository`,
    scopes: "api, read_user, write_repository",
  },
};

export function PreferencesDialog() {
  const accounts = useStore((s) => s.accounts);
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.info);
  const set = useStore((s) => s.set);
  const [kind, setKind] = useState<"github" | "gitlab">("github");
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = host.trim()
    ? /^https?:\/\//.test(host.trim())
      ? host.trim().replace(/\/+$/, "")
      : `https://${host.trim().replace(/\/+$/, "")}`
    : kind === "github"
      ? "https://github.com"
      : "https://gitlab.com";

  const add = async () => {
    setAdding(true);
    setError(null);
    try {
      const acc = await api.accountAdd(kind, host, token);
      await A.reloadAccounts();
      setToken("");
      setHost("");
      A.toast("success", `Account ${acc.username}@${acc.host} collegato${acc.tokenInFile ? " (token salvato su file: portachiavi non disponibile)" : ""}`);
      // Repositories already open may now resolve their provider.
      const st = useStore.getState();
      for (const p of st.tabs) A.refresh(p).then(() => A.loadPullRequests(p, true));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    if (!(await A.confirm("Scollega account", "Rimuovere l'account e cancellare il token dal portachiavi?", { danger: true, confirmLabel: "Rimuovi" }))) return;
    await api.accountRemove(id).catch((e) => A.toast("error", errorText(e)));
    await A.reloadAccounts();
  };

  const upd = (patch: Partial<Settings>) => A.saveSettings(patch);

  return (
    <Modal title="Preferenze" onClose={() => set({ modal: null })} width={680}>
      <div className="prefs">
        <section>
          <h3>Account GitHub / GitLab</h3>
          {accounts.length === 0 && <p className="muted">Nessun account collegato.</p>}
          {accounts.map((a) => (
            <div key={a.id} className="account-row">
              {a.avatarUrl ? <img className="avatar-img" src={a.avatarUrl} alt="" /> : <ProviderIcon kind={a.kind} />}
              <div className="recent-text">
                <span>
                  {a.name ?? a.username} <span className="muted">@{a.username}</span>
                </span>
                <span className="muted small">
                  {a.kind === "github" ? "GitHub" : "GitLab"} · {a.host}
                  {a.tokenInFile && " · token su file"}
                </span>
              </div>
              <button className="icon-btn danger" title="Rimuovi" onClick={() => remove(a.id)}>
                <Trash size={14} />
              </button>
            </div>
          ))}

          <div className="add-account">
            <div className="seg">
              <button className={kind === "github" ? "on" : ""} onClick={() => setKind("github")}>
                <ProviderIcon kind="github" size={14} /> GitHub
              </button>
              <button className={kind === "gitlab" ? "on" : ""} onClick={() => setKind("gitlab")}>
                <ProviderIcon kind="gitlab" size={14} /> GitLab
              </button>
            </div>
            <label className="field">
              <span className="field-label">Server (vuoto per {kind === "github" ? "github.com" : "gitlab.com"})</span>
              <input
                className="mono"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder={kind === "github" ? "github.azienda.it (Enterprise)" : "gitlab.azienda.it"}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span className="field-label">Personal access token</span>
              <input className="mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… / glpat-…" spellCheck={false} />
              <span className="field-help">
                Permessi necessari: <span className="mono">{TOKEN_HELP[kind].scopes}</span>.{" "}
                <a onClick={() => A.openExternal(TOKEN_HELP[kind].url(base))}>
                  Crea un token <ExternalLink size={11} />
                </a>
                . Il token resta nel portachiavi di sistema e serve anche per pull/push via HTTPS.
              </span>
            </label>
            {error && <div className="error-text">{error}</div>}
            <button className="btn btn-primary" disabled={!token.trim() || adding} onClick={add}>
              {adding ? <RefreshCw size={14} className="spin" /> : <KeyRound size={14} />} Collega account
            </button>
          </div>
        </section>

        <section>
          <h3>Generale</h3>
          <label className="field inline">
            <span className="field-label">Tema</span>
            <select value={settings?.theme ?? "system"} onChange={(e) => upd({ theme: e.target.value as Settings["theme"] })}>
              <option value="system">Come il sistema</option>
              <option value="dark">Scuro</option>
              <option value="light">Chiaro</option>
            </select>
          </label>
          <label className="field inline">
            <span className="field-label">Pull predefinito</span>
            <select value={settings?.pullMode ?? "ff"} onChange={(e) => upd({ pullMode: e.target.value as Settings["pullMode"] })}>
              <option value="ff">Fast-forward se possibile, altrimenti merge</option>
              <option value="ff-only">Solo fast-forward</option>
              <option value="rebase">Rebase</option>
            </select>
          </label>
          <label className="field inline">
            <span className="field-label">Commit caricati nel grafo</span>
            <select
              value={String(settings?.graphLimit ?? 2000)}
              onChange={(e) => {
                const n = Number(e.target.value);
                upd({ graphLimit: n });
                const st = useStore.getState();
                for (const p of st.tabs) {
                  st.patchRepo(p, { graphLimit: n });
                  A.refresh(p, { full: true });
                }
              }}
            >
              {[500, 1000, 2000, 5000, 10000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="muted small">
          GitPilot {info?.version} · {info?.gitVersion} · configurazione in <span className="mono">{info?.configDir}</span>
        </section>
      </div>
    </Modal>
  );
}
