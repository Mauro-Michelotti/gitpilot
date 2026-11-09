# Changelog

## [0.2.0] - 2026-11-09

Confronto con la versione precedente: [v0.1.1...v0.2.0](../../compare/v0.1.1...v0.2.0). Comprende 6 commit e 7 merge.

### Da fare al rilascio

- `settings.json` ha la nuova impostazione `language`, che vale "come il sistema" se manca: le
  impostazioni esistenti si caricano senza interventi. Chi ha il sistema in una lingua diversa
  dall'italiano, dopo l'aggiornamento vede GitPilot in inglese; per tornare all'italiano:
  Preferenze → Lingua → Italiano.

### Novità

- Pull dei branch locali non in checkout ([#4](../../issues/4)): voce "Pull (solo fast-forward)"
  nel menu di ogni branch locale.
  - Fa il fetch dell'upstream e porta avanti il branch senza cambiare branch e senza toccare
    working tree e index.
  - La voce è disabilitata se il branch non ha upstream o se l'upstream è stato eliminato sul
    remote.
  - Branch divergente, in checkout in un altro worktree o con rebase/bisect in corso: nessuna
    modifica, con un messaggio che spiega il motivo.
- Pull di tutti i branch ([#6](../../issues/6)): voce "Pull di tutti i branch (fast-forward)" nel
  menu del Pull.
  - Un solo fetch per remote, poi ogni branch locale con upstream viene portato avanti in
    fast-forward. Non fa mai merge o rebase, quindi non si ferma su conflitti.
  - Il branch corrente si aggiorna solo con `merge --ff-only`; se le modifiche locali lo
    impediscono viene saltato, con l'elenco dei file.
  - Se va tutto bene compare un avviso; se qualche branch è stato saltato, un riepilogo con i
    branch aggiornati, quelli già aggiornati e quelli saltati con il motivo (divergente, in
    checkout in un altro worktree, upstream eliminato sul remote, fetch del remote non riuscito).
- Lingua inglese ([#7](../../issues/7)): Preferenze → Lingua, con "Come il sistema" (predefinita),
  Italiano ed English. Il cambio vale subito, senza riavvio.
  - Seguono la lingua interfaccia, date (relative e complete), messaggi di GitPilot e messaggi
    di `git`.
  - Restano in italiano i testi che GitPilot scrive nel repository: il messaggio di reflog del
    pull in fast-forward e i messaggi dei tag proposti da Git Flow.
  - Con un solo elemento i testi usano il singolare (es. "1 file cambiato").

### Modifiche

- Al cambio scheda il repository viene ricaricato per intero ([#2](../../issues/2)): compaiono
  anche le modifiche fatte fuori da GitPilot. Aggiorna, `F5` e `Ctrl/Cmd+R` ricaricano anche le
  pull request, e l'icona di Aggiorna gira finché il ricaricamento è in corso.
- Dettaglio commit: i nomi lunghi di branch e tag si leggono interi
  ([`f39b3810`](../../commit/f39b3810224d4888e1d456aaea1c4f8ba63e3c41)). Prima andavano a capo
  dentro il chip e si sovrapponevano alla riga sotto; ora ogni chip sta su una riga e viene
  troncato solo se è più largo del pannello, con il nome completo nel tooltip.
- Grafo, colonna Branch / tag: il chip del branch corrente non si riduce più a una lettera
  ([`c37eb6c7`](../../commit/c37eb6c7ddcb39a3da891c46cf25497b2c671683)). Il primo chip si vede
  intero, il secondo solo se ci sta intero, altrimenti finisce nel contatore "+N" (con i nomi
  nel tooltip). Con una sola corsia l'intestazione "Grafo" non è più tagliata.

### Documentazione

- `README.md`: pull dei branch non in checkout e di tutti i branch, lingua, cartella `locales/`
  nella struttura del progetto.

<details>
<summary>Elenco dei commit</summary>

| Commit | Data | Autore | Messaggio |
|--------|------|--------|-----------|
| [`c37eb6c7`](../../commit/c37eb6c7ddcb39a3da891c46cf25497b2c671683) | 2026-11-09 | Mauro Michelotti | fix(ui): non troncare chip e intestazione nella colonna del grafo |
| [`17d0d975`](../../commit/17d0d975624eda12378cca7e20f65a13b9113b92) | 2026-11-09 | Mauro Michelotti | feat(i18n): aggiungi la lingua inglese |
| [`f39b3810`](../../commit/f39b3810224d4888e1d456aaea1c4f8ba63e3c41) | 2026-11-09 | Mauro Michelotti | fix(ui): mostra interi i nomi lunghi nei chip del dettaglio commit |
| [`879c4a51`](../../commit/879c4a513c0d2824087dc0d171f196d42802032c) | 2026-11-09 | Mauro Michelotti | feat(branch): aggiungi pull di tutti i branch locali |
| [`ed7ce0c6`](../../commit/ed7ce0c6c116082c1c1db3e83fe9ed457f153e53) | 2026-11-06 | Mauro Michelotti | feat(branch): aggiungi pull dei branch locali non in checkout |
| [`5495360e`](../../commit/5495360e9b672c1069266ec9f151dc953b1246b4) | 2026-11-06 | Mauro Michelotti | fix(ui): ricarica il repo al cambio scheda con feedback visivo |

</details>

## [0.1.1] - 2026-11-05

Confronto con la versione precedente: [v0.1.0...v0.1.1](../../compare/v0.1.0...v0.1.1). Comprende 2 commit e 1 merge.

### Modifiche

- Sidebar e pannello dettagli si ridimensionano di nuovo trascinando i bordi ([#5](../../issues/5)).
  Prima il pannello si spostava di pochi pixel e tornava alla larghezza iniziale.
  - La larghezza segue il mouse, entro 180–520 px a sinistra e 280–700 px a destra.
  - Il trascinamento continua anche se il puntatore esce dal bordo.
  - La larghezza viene salvata al rilascio del mouse e resta uguale al riavvio.

### Documentazione

- Skill `changelog` e `release` in `.claude/skills/`: generano questo changelog e guidano il
  rilascio (SemVer, release candidate `vX.Y.Z-rc.N`, git-flow).

<details>
<summary>Elenco dei commit</summary>

| Commit | Data | Autore | Messaggio |
|--------|------|--------|-----------|
| [`9e947e55`](../../commit/9e947e55f9478a58f879584718fc16e5459f532d) | 2026-11-05 | Mauro Michelotti | chore(skill): aggiungi skill changelog e release |
| [`7d55a7e6`](../../commit/7d55a7e673247d9d33e2d39eb9eb1e946f6e89a0) | 2026-11-05 | Mauro Michelotti | fix(ui): correggi ridimensionamento sezioni laterali |

</details>
