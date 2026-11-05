---
name: changelog
description: >
  Rigenera la sezione di una release in CHANGELOG.md di GitPilot, confrontandola con il tag di
  release precedente (vX.Y.Z): azioni da fare al rilascio, novità, sicurezza, modifiche,
  pacchetti e build, documentazione ed elenco dei commit, con link relativi a issue e commit.
  Usare quando l'utente chiede il changelog o le note di rilascio, cosa c'è in una release, di
  aggiornare il changelog dopo aver aperto o chiuso una release git-flow, o invoca /changelog.
  Argomento opzionale: la versione (es. 0.2.0 o v0.2.0).
---

# Changelog della release

Portata dalla skill omonima di iEntry e adattata a GitPilot: tag `vX.Y.Z`, niente migrazioni,
pacchetti costruiti da GitHub Actions (vedi la skill `release`).

Scrive o rigenera in `CHANGELOG.md` (root del repo) la sezione di **una** release, confrontata
con il tag di release precedente. Non committa, non tagga, non pusha.

## Flusso

1. **Raccogli i dati** (sola lettura):
   ```bash
   bash .claude/skills/changelog/collect.sh [VERSIONE]
   ```
   - Accetta `0.2.0` o `v0.2.0`. Senza argomento, su `release/X.Y.Z` o `hotfix/X.Y.Z` usa HEAD
     e quella versione; negli altri casi usa l'ultimo tag `vX.Y.Z` di `main`.
   - Il tag precedente è l'ultimo tag **stretto** `vX.Y.Z` antenato della fine. I tag con
     suffisso (`v0.2.0-rc.1`) non sono release e vengono scartati; lo script li elenca.
   - Comunica all'utente il range usato (es. `v0.1.0...v0.2.0`) e chiedi conferma solo se è
     ambiguo: tag mancante, versione non ancora taggata, tag precedente inatteso.

2. **Capisci i cambiamenti, non copiare i messaggi.**
   - Leggi corpo e statistiche dei commit significativi:
     `git log -1 --format=%B <sha>`, `git show --stat <sha>`.
   - Raggruppa per issue: titoli e stato vengono dallo script. Per una PR (`pull`) il link
     punta a `../../pull/N`. I branch git-flow si chiamano `feature/<n>-descrizione`: il numero
     è la issue.
   - **Verifica sul codice** le affermazioni operative. I messaggi di commit possono essere
     superati da commit successivi: nel changelog va il comportamento reale, non quello del
     messaggio.

3. **Scrivi la sezione** con il formato qui sotto.
   - Versione più recente in alto.
   - Se la sezione della versione esiste già, sostituisci solo quella; le altre restano intatte.
   - Se `CHANGELOG.md` non esiste, crealo con l'intestazione `# Changelog`.

4. **README**: deve avere la sezione `## Changelog` con il link a `CHANGELOG.md`. Se manca,
   aggiungila in italiano come il resto del file, prima di `## Problemi noti`.

5. **Verifica**:
   - nessun `#NNN` senza link;
   - nessun link assoluto `https://github.com/...` nel changelog;
   - ogni commit linkato è sul remoto. Se lo script segnala commit non pushati, avvisa: quei
     link funzioneranno solo dopo il push;
   - le issue esistono (output dello script).

6. **Chiudi**:
   - riassumi in chat cosa contiene la sezione e le correzioni fatte rispetto ai messaggi di
     commit;
   - proponi il messaggio di commit, per esempio
     `docs(release): aggiungi changelog della versione X.Y.Z` (in italiano, come i commit del
     repo);
   - il commit lo fa l'utente con `/git-commit`, dopo aver messo i file in stage.

## Formato

Contenuto in **italiano**, frasi brevi, nomi tecnici esatti fra backtick. Intestazione del file:
`# Changelog`.

```markdown
## [X.Y.Z] - AAAA-MM-GG

Confronto con la versione precedente: [vP.Q.R...vX.Y.Z](../../compare/vP.Q.R...vX.Y.Z). Comprende N commit e M merge.

### Da fare al rilascio
### Novità
### Sicurezza
### Modifiche
### Pacchetti e build
### Documentazione

<details>
<summary>Elenco dei commit</summary>

| Commit | Data | Autore | Messaggio |
|--------|------|--------|-----------|
| [`abcd1234`](../../commit/<sha completo>) | AAAA-MM-GG | Autore | messaggio originale |

</details>
```

- **Titolo**: la versione senza `v` (`## [0.2.0]`); nei link di confronto si usano i tag (`v0.2.0`).
- **Data**: la data del commit di fine (tag o HEAD).
- **Conteggi**: commit senza merge e merge, dallo script.
- **Sezioni vuote**: si omettono.

### Contenuto delle sezioni

- **Da fare al rilascio**: tutto quello che chi rilascia o chi aggiorna l'app deve fare o
  controllare. Per ogni voce: cosa fare e perché. Casi tipici:
  - formato di `settings.json` cambiato (`crates/gitpilot-core/src/settings.rs`): cosa succede
    alle impostazioni esistenti;
  - account o token salvati nel portachiavi del sistema da ricollegare;
  - nuova versione minima di `git` o nuove dipendenze di sistema (WebKitGTK, librerie per il
    `.deb`/`.rpm`);
  - nuovi permessi Tauri (`src-tauri/capabilities`);
  - passi manuali su macOS (firma ad-hoc, `xattr -dr com.apple.quarantine`).
- **Novità**: una voce per funzionalità, con link alla issue (`[#5](../../issues/5)`).
  Sotto-punti solo se servono a capire cosa c'è.
- **Sicurezza**: vulnerabilità chiuse e controlli aggiunti: cosa era esposto, cosa succede ora.
  Per le hotfix senza issue, link al commit.
- **Modifiche**: cambiamenti visibili che non sono funzionalità nuove (interfaccia,
  comportamento, correzioni di bug, refactor rilevanti).
- **Pacchetti e build**: workflow GitHub Actions, formati dei pacchetti, piattaforme,
  dipendenze principali (Tauri, React), configurazione in `src-tauri/tauri.conf.json`. Lo
  script elenca i file cambiati.
- **Documentazione**: `README.md`, `CLAUDE.md`, skill in `.claude/skills/`.

### Link

- **Sempre relativi** (`…/blob/<branch>/CHANGELOG.md` → `../../`):
  - issue `[#5](../../issues/5)`;
  - PR `[#6](../../pull/6)`;
  - commit ``[`aa0219fe`](../../commit/<sha completo>)``;
  - confronto `[v0.1.0...v0.2.0](../../compare/v0.1.0...v0.2.0)`.
- **Mai `#NNN` senza link**: in un file del repository GitHub non lo collega.
- **Anche i `#NNN` dentro i messaggi** della tabella dei commit vanno linkati.
- **Limite**: aperti da un branch con `/` nel nome (es. `feature/x`) i link relativi si
  rompono; da `main`, `develop` e dai tag funzionano.

## Confini

- **Modifiche ammesse**: solo `CHANGELOG.md` e, se manca il rimando, `README.md`.
- **Git**: nessun commit, tag, push, merge o cambio di branch.
- **Contenuti inventati**: se un'informazione non si ricava dai commit o dal codice, non
  scriverla; chiedila all'utente.
