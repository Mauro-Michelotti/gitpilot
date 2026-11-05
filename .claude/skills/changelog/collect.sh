#!/usr/bin/env bash
# Raccoglie i dati per la sezione del CHANGELOG di una release GitPilot.
# Portato da iEntry (.claude/skills/changelog/collect.sh) e adattato: tag vX.Y.Z, niente Flyway.
#
# Uso: collect.sh [VERSIONE|TAG]   (0.2.0 oppure v0.2.0)
#   - senza argomenti: sul branch release/X.Y.Z o hotfix/X.Y.Z usa HEAD come fine e X.Y.Z come
#     versione, altrimenti l'ultimo tag vX.Y.Z raggiungibile da main;
#   - con argomento: il tag indicato (se non esiste ancora, fine = HEAD).
# Il tag precedente e' l'ultimo tag stretto vX.Y.Z (senza suffissi come v0.2.0-rc.1) antenato
# della fine e con versione minore.
# Sola lettura: non modifica file, branch o tag (fa solo un `git fetch` per confrontare con origin).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
SEMVER='^v[0-9]+\.[0-9]+\.[0-9]+$'
# File che cambiano build, pacchetti, CI o permessi dell'app.
BUILD=(.github/workflows package.json Cargo.toml src-tauri/Cargo.toml crates/gitpilot-core/Cargo.toml
       src-tauri/tauri.conf.json src-tauri/capabilities src-tauri/icons vite.config.ts)

branch=$(git rev-parse --abbrev-ref HEAD)
target=${1:-}
if [[ -z "$target" && "$branch" =~ ^(release|hotfix)/v?([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  target=${BASH_REMATCH[2]}
fi
if [[ -z "$target" ]]; then
  target=$(git tag --merged main | grep -E "$SEMVER" | sort -V | tail -1)
fi
tag="v${target#v}"
[[ "$tag" =~ $SEMVER ]] || { echo "ERRORE: versione non valida: $target (attesa X.Y.Z o vX.Y.Z)" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  end="$tag"
else
  end=HEAD
fi

prev=$(git tag --merged "$end" | grep -E "$SEMVER" | grep -vx "$tag" \
  | { while read -r t; do [[ "$(printf '%s\n%s\n' "$t" "$tag" | sort -V | head -1)" == "$t" ]] && echo "$t"; done; } \
  | sort -V | tail -1 || true)
[[ -n "$prev" ]] || { echo "ERRORE: nessun tag vX.Y.Z precedente a $tag" >&2; exit 1; }

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)

echo "== RANGE"
echo "versione: ${tag#v} (tag $tag)"
echo "fine: $end ($(git rev-parse --short "$end^{commit}"))"
echo "precedente: $prev ($(git rev-parse --short "$prev^{commit}"))"
echo "data: $(git log -1 --format=%ad --date=short "$end")"
echo "commit: $(git rev-list --count --no-merges "$prev..$end")"
echo "merge: $(git rev-list --count --merges "$prev..$end")"
echo "repo GitHub: ${repo:-?}"
echo "tag non semver scartati nel range: $(git tag --merged "$end" --no-merged "$prev" | grep -vE "$SEMVER" | paste -sd' ' || true)"

echo
echo "== COMMIT (non merge, dal piu' recente): sha|short|data|autore|messaggio"
git log "$prev..$end" --no-merges --format='%H|%h|%ad|%an|%s' --date=short --abbrev=8

echo
echo "== MERGE"
git log "$prev..$end" --merges --format='%h|%ad|%s' --date=short --abbrev=8

echo
echo "== ISSUE E PR CITATE (messaggi, trailer, nomi branch feature/<n>-)"
refs=$( { git log "$prev..$end" --format='%s%n%b' | grep -oE '#[0-9]+' | tr -d '#';
          git log "$prev..$end" --merges --format='%s' | grep -oE '(feature|hotfix|bugfix)/[0-9]+' | grep -oE '[0-9]+'; } \
        | sort -un || true)
for n in $refs; do
  if [[ -n "$repo" ]] && info=$(gh api "repos/$repo/issues/$n" \
       -q '(if .pull_request then "pull" else "issues" end) + "|" + .state + "|" + .title' 2>/dev/null); then
    echo "#$n|$info"
  else
    echo "#$n|?|non trovata|"
  fi
done

echo
echo "== FILE DI BUILD, PACCHETTI, CI E PERMESSI modificati nel range"
git diff --stat=100 "$prev" "$end" -- "${BUILD[@]}" || true

echo
echo "== DOCUMENTAZIONE modificata nel range"
git diff --name-status "$prev" "$end" -- '*.md' ':!CHANGELOG.md' || true

echo
echo "== COMMIT NON ANCORA SUL REMOTO (i link ../../commit/<sha> non funzionerebbero)"
git fetch -q origin 2>/dev/null || true
for sha in $(git rev-list "$prev..$end"); do
  [[ -n "$(git branch -r --contains "$sha" 2>/dev/null)" ]] || git log -1 --format='%h %s' "$sha"
done

echo
echo "== README / CHANGELOG"
if grep -q 'CHANGELOG.md' README.md; then echo "README rimanda gia' a CHANGELOG.md"; else echo "README: MANCA il rimando a CHANGELOG.md"; fi
if [[ -f CHANGELOG.md ]]; then
  echo "sezione ${tag#v} gia' presente in CHANGELOG.md: $(grep -cE "^## \[${tag#v}\]" CHANGELOG.md || true)"
else
  echo "CHANGELOG.md: ASSENTE (va creato con intestazione '# Changelog')"
fi
