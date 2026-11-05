# Changelog

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
