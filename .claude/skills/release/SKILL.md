---
name: release
description: >
  Guida il rilascio di GitPilot con versionamento SemVer e release candidate. Chiede se il
  rilascio e' di prova (tag vX.Y.Z-rc.N) o definitivo, propone l'avanzamento di versione (major,
  minor o patch) dai commit e, nel definitivo, apre la release GitFlow, alza la versione e
  rigenera il changelog. Usare quando l'utente chiede di rilasciare, taggare, fare un RC o una
  release candidate, aprire una release o un hotfix, alzare la versione, o invoca /release.
  Argomento opzionale: major, minor, patch oppure rc.
---

# Release (RC o definitiva)

Portata dalla skill omonima di iEntry e adattata a GitPilot. Per il changelog usa la skill
`changelog`. Non fa mai `git flow release finish`, push o merge: sono azioni verso l'esterno (la
CI costruisce i pacchetti e crea la Release su GitHub) e le fa l'utente.

## Come si rilascia GitPilot

- **Tag**: `vX.Y.Z` (release) e `vX.Y.Z-rc.N` (release candidate), annotati. Rami git-flow
  `release/X.Y.Z` e `hotfix/X.Y.Z`, senza `v`.
- **CI**: il push di un tag `v*` lancia `.github/workflows/build.yml`, che costruisce macOS arm64
  (`.app`, `.dmg`) e Linux x86_64 (`.AppImage`, `.deb`, `.rpm`) e crea una **Release in bozza**
  `GitPilot <tag>` con i pacchetti. La bozza la pubblica l'utente da GitHub.
- **Prova senza tag**: GitHub → Actions → *Build* → *Run workflow* sul ramo voluto; i pacchetti
  restano negli artifact del run, senza Release.
- **Versione nei file**: `package.json` (e `package-lock.json`), `src-tauri/tauri.conf.json`
  (dà il nome ai pacchetti) e `version` di `[workspace.package]` in `Cargo.toml` (e
  `Cargo.lock`). Devono restare allineate.

## Flusso

1. **Stato** (sola lettura):
   ```bash
   bash .claude/skills/release/release.sh
   ```
   Riporta in sintesi ramo, ultimo tag, versione nei file, commit dall'ultimo tag e rami
   `release/*`/`hotfix/*` aperti. Ferma tutto se il working tree non e' pulito o `develop` non
   e' allineato a `origin`. Se `git flow` e' assente, dillo subito all'utente: userai i comandi
   `git` equivalenti.

2. **Domanda** (`AskUserQuestion`): rilascio **di prova (RC)** o **definitivo**? Se
   l'argomento dice gia' `rc` o un tipo di avanzamento, non chiedere.

3. **Avanzamento** (major/minor/patch), proposto dai commit dello script e confermato
   dall'utente:
   - `feat!:`, `BREAKING CHANGE` o passo manuale per chi aggiorna (impostazioni non piu'
     compatibili, account da ricollegare) → **major**;
   - almeno un `feat` → **minor**;
   - solo `fix`, `docs`, `chore`, `refactor`, `perf`, `build`, `ci`, `test`, `style` → **patch**.

   Dai la motivazione in una riga. Se esiste gia' un RC della versione proposta, riusa quella
   versione, a meno che i commit successivi non richiedano un salto piu' alto.

4. **RC**
   - **Ramo**: HEAD di `develop`; su un `hotfix/*` aperto, quel ramo. Se l'utente vuole un altro
     ramo (`release/*`, `feature/*`...) chiedi conferma e ricorda che non e' la prassi del
     progetto. Se esiste un `release/*` aperto, avvisa che un RC su `develop` non contiene le
     correzioni del ramo di release e chiedi come procedere.
   - **Numero**: dallo script (max `N` esistente + 1).
   - Mostra il comando, chiedi conferma, poi
     `git tag -a vX.Y.Z-rc.N -m "GitPilot X.Y.Z-rc.N"`.
   - **Push del tag**: richiesta a parte (fa partire la CI e crea una Release in bozza).
   - Nessun bump della versione nei file, nessun changelog: i pacchetti dell'RC portano ancora
     nel nome la versione precedente (da `tauri.conf.json`); dillo all'utente.

5. **Definitiva**
   - Non partire con tag esistente per la versione: fermati.
   - `git flow release start X.Y.Z` (o `git checkout -b release/X.Y.Z develop`, segnalandolo).
     Per un hotfix (solo `PATCH`, correzione urgente su `main`): `git flow hotfix start X.Y.Z`
     (o `git checkout -b hotfix/X.Y.Z main`), stessi passi seguenti e `git flow hotfix finish`.
   - Bump della versione:
     - `npm version X.Y.Z --no-git-tag-version` (aggiorna `package.json` e `package-lock.json`);
     - `"version"` in `src-tauri/tauri.conf.json`;
     - `version` di `[workspace.package]` in `Cargo.toml`, poi `cargo update --workspace --offline`
       per allineare `Cargo.lock`.
   - Esegui la skill `changelog X.Y.Z`.
   - Fermati e consegna all'utente:
     - commit da fare con `/git-commit`: `build(release): porta la versione a X.Y.Z` e
       `docs(release): aggiungi changelog della versione X.Y.Z`;
     - chiusura:
       ```bash
       printf 'GitPilot X.Y.Z\n' > /tmp/gitpilot-tag.txt
       git flow release finish -T vX.Y.Z -f /tmp/gitpilot-tag.txt X.Y.Z
       ```
       Il prefisso dei tag git-flow e' vuoto, quindi il nome del tag va dato con `-T`. Il
       messaggio va passato con `-f`: git-flow AVH 1.12.3 spezza `-m "GitPilot X.Y.Z"` sugli
       spazi e il tag esce con messaggio `GitPilot X.Y.Z vX.Y.Z` (verificato il 05/11/2026).
       Per un hotfix: `git flow hotfix finish` con le stesse opzioni. Senza git flow: merge
       `--no-ff` in `main`, tag annotato `vX.Y.Z`, back-merge in `develop`;
     - push di `main`, `develop` e del tag: la CI crea la Release in bozza, che l'utente
       controlla e pubblica (puo' incollarci la sezione del changelog).
   - Ricorda di eliminare a mano le Release in bozza e i tag degli RC della versione. Non
     proporre i comandi di cancellazione.

6. **Riepilogo**: versione, tipo, rami e tag creati, comandi che restano all'utente.

## Vincoli

- Mai `--force`; mai riscrivere un tag gia' pushato; se il tag esiste gia', fermati.
- Nessun commit, tag o ramo senza conferma esplicita.
- Gli ordinamenti dei tag usano `git -c versionsort.suffix=-rc`, altrimenti `vX.Y.Z-rc.N`
  risulta dopo `vX.Y.Z`.
- Messaggi di commit in italiano (Conventional Commits, come il resto del repo); messaggi dei
  tag `GitPilot <versione>`, come `v0.1.0`.
