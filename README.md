# GitPilot

Client Git desktop per Linux e macOS (anche Windows), ispirato a GitKraken:
grafo dei commit, GitFlow nativo, integrazione GitHub e GitLab (anche self-hosted).

Stack: **Tauri 2** (backend Rust) + **React/TypeScript** (UI). Il backend usa il
`git` installato nel sistema, quindi chiavi SSH, credential helper, hook, firma
GPG, LFS e `includeIf` funzionano esattamente come da terminale.

## Funzioni

- **Repository**: apri, clona (da URL o dalla lista dei tuoi repo GitHub/GitLab), crea; schede multiple, recenti.
- **Gruppi di repository**: più repo dello stesso progetto (es. backend, frontend, mobile) in una sola
  scheda con sotto-schede. `Ctrl+clic` sulle schede per selezionarle, poi clic destro → *Raggruppa…*;
  dal menu del gruppo rinomina, aggiungi/togli repo, sciogli. Chiudere un gruppo chiude tutti i suoi
  repo, riaprirlo dalla Home li riapre; i gruppi restano salvati tra un avvio e l'altro.
- **Grafo commit** virtualizzato (migliaia di commit), corsie colorate, avatar autore, chip branch/tag
  (locale + remoto uniti), riga WIP; doppio clic su un chip = checkout.
- **Working copy**: stage/unstage per file o per **blocco** (hunk), scarta, commit con sommario/descrizione,
  amend; diff unificato o affiancato.
- **Branch, tag, stash, remote**: crea, rinomina, elimina (anche sul remote), upstream, push/pull/fetch
  (pull fast-forward / solo ff / rebase, force push con `--force-with-lease`); pull in fast-forward
  anche dei branch locali non in checkout, senza cambiare branch, e di tutti i branch locali insieme
  (un fetch per remote, riepilogo dei branch aggiornati e di quelli saltati con il motivo).
- **Merge, rebase, cherry-pick, revert, reset** (soft/mixed/hard) da menu contestuale.
- **Conflitti**: banner di stato con Continua/Salta/Annulla, editor a due lati + base con risultato
  modificabile, "tutto nostro/loro", conflitti di eliminazione.
- **Git Flow** senza estensioni esterne: init, start/finish di feature, bugfix, release, hotfix
  (merge `--no-ff`, tag annotato, back-merge del tag in develop, push opzionale).
  Usa le chiavi `gitflow.*` di git-flow AVH, quindi è compatibile con repo inizializzati da GitKraken.
- **GitHub / GitLab**: account con personal access token (salvato nel portachiavi di sistema:
  GNOME Keyring/KWallet, Portachiavi macOS), lista PR/MR del repo, creazione PR/MR, clone dai tuoi repo.
  Il token viene usato anche per autenticare pull/push via HTTPS.
- **Lingua**: italiano o inglese (Preferenze → Lingua, oppure come il sistema), con cambio immediato;
  seguono la lingua anche i messaggi di GitPilot e quelli di git.

## Struttura

```
crates/gitpilot-core/   logica (git, grafo, diff, conflitti, GitFlow, provider) — testabile da sola
src-tauri/              shell Tauri: comandi esposti alla UI
src/                    UI React (actions.ts = logica UI, components/ = viste, locales/ = testi it/en)
```

## Requisiti

- Rust ≥ 1.80, Node ≥ 20.19 (`nvm use` legge `.nvmrc` → Node 22), `git` ≥ 2.31
- **Linux (Debian/Ubuntu)**:
  ```
  sudo apt install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev build-essential
  ```
- **macOS**: `xcode-select --install`

## Sviluppo

```
nvm use
npm install
npm run tauri dev          # app con hot reload
cargo test -p gitpilot-core  # test (unit + integrazione su repo temporanei)
```

## Pacchetti

```
npm run tauri build
```

Su Linux produce `.deb`, `.rpm` e `.AppImage` in `target/release/bundle/`; su macOS `.app` e `.dmg`
(va compilato su un Mac).

Il `.deb` installa anche il lanciatore (`/usr/share/applications/GitPilot.desktop`) e le icone:

```
sudo apt install ./target/release/bundle/deb/GitPilot_0.1.0_amd64.deb
```

### Build su GitHub Actions (macOS senza Mac, Linux)

Il workflow `.github/workflows/build.yml` esegue i test di `gitpilot-core` e compila in parallelo:

- **macOS arm64** (M1 e successivi) → `.app` + `.dmg`
- **Linux x86_64** su Ubuntu 22.04 → `.AppImage` + `.deb` + `.rpm` (girano su Ubuntu 22.04+,
  Debian 12+, Fedora 36+)

Come lanciarlo:

- **Build manuale**: GitHub → Actions → *Build* → *Run workflow*. I pacchetti si scaricano dagli
  artifact del run.
- **Release**: `git tag v0.1.0 && git push --tags` → crea una Release in bozza con tutti i pacchetti.
  Prima del tag aggiornare `version` in `src-tauri/tauri.conf.json` (dà il nome ai file).

#### macOS: primo avvio

L'app ha firma ad-hoc e non è notarizzata (niente Apple Developer ID): dopo averla trascinata in
Applicazioni, al primo avvio:

```
xattr -dr com.apple.quarantine /Applications/GitPilot.app
```

(in alternativa: Impostazioni di Sistema → Privacy e sicurezza → *Apri comunque*).

Icone: `app-icon.svg` è la sorgente per Linux/Windows; `app-icon-macos.svg` è la stessa grafica con il
margine della griglia macOS, usata solo per `icon.icns`:

```
npx tauri icon app-icon.svg                       # tutte le icone
npx tauri icon app-icon-macos.svg -o /tmp/mac && cp /tmp/mac/icon.icns src-tauri/icons/
```

## Account

Preferenze → Account. Permessi del token:

- GitHub: `repo`, `read:org`, `workflow`
- GitLab: `api`, `read_user`, `write_repository`

Per GitHub Enterprise o GitLab self-hosted indica l'indirizzo del server (es. `gitlab.azienda.it`).

## Changelog

Le novità di ogni versione sono in [CHANGELOG.md](CHANGELOG.md).

## Problemi noti

- Finestra bianca su Linux con alcuni driver GPU (tipico NVIDIA/Wayland): avviare con
  `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- Le chiavi SSH protette da passphrase devono essere caricate in ssh-agent: GitPilot non
  mostra prompt di passphrase.

## Scorciatoie

`F5`/`Ctrl+R` aggiorna · `Ctrl+O` apri · `Ctrl+W` chiudi scheda (o il gruppo) · `Ctrl+Invio` commit ·
`Ctrl+Tab`/`Ctrl+Shift+Tab` scheda successiva/precedente · `Ctrl+PagGiù`/`Ctrl+PagSu` sotto-scheda del gruppo ·
`↑/↓` naviga il grafo · `Esc` chiude diff/dialoghi · `Ctrl +/-/0` zoom (su macOS `⌘` al posto di `Ctrl`,
tranne `Ctrl+Tab`)
