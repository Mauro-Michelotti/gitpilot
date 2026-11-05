#!/usr/bin/env bash
# Raccoglie lo stato per un rilascio GitPilot (RC o prod).
# Portato da iEntry (.claude/skills/release/release.sh) e adattato: tag vX.Y.Z e vX.Y.Z-rc.N,
# versione in package.json, src-tauri/tauri.conf.json e Cargo.toml.
#
# Uso: release.sh
# Sola lettura: non modifica file, branch o tag.
# Ordina i tag con versionsort.suffix=-rc, cosi' vX.Y.Z-rc.N precede vX.Y.Z.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
SEMVER='^v[0-9]+\.[0-9]+\.[0-9]+$'
RC='^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$'
gitv() { git -c versionsort.suffix=-rc "$@"; }

branch=$(git rev-parse --abbrev-ref HEAD)
# Fine del range: develop (o il ramo hotfix corrente), non il ramo da cui si lancia lo script.
if [[ "$branch" =~ ^hotfix/ ]]; then end=HEAD; else
  end=$(git rev-parse -q --verify develop >/dev/null && echo develop || echo HEAD)
fi
# Ultimo tag stretto raggiungibile dalla fine: git flow (AVH) riporta il tag di main in develop
# con il back-merge.
last=$(gitv tag --merged "$end" --sort=v:refname | grep -E "$SEMVER" | tail -1 || true)
[[ -n "$last" ]] || { echo "ERRORE: nessun tag vX.Y.Z raggiungibile da $end" >&2; exit 1; }

echo "== STATO"
echo "ramo corrente: $branch"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree: NON PULITO"
  git status --short
else
  echo "working tree: pulito"
fi
if git rev-parse -q --verify origin/develop >/dev/null && git rev-parse -q --verify develop >/dev/null; then
  read -r ahead behind < <(git rev-list --left-right --count develop...origin/develop)
  echo "develop vs origin/develop: $ahead avanti, $behind indietro"
else
  echo "develop vs origin/develop: non verificabile (ramo o remoto mancante)"
fi
if git flow version >/dev/null 2>&1; then echo "git flow: installato ($(git flow version))"; else
  echo "git flow: ASSENTE (usare i comandi git equivalenti e segnalarlo all'utente)"
fi
echo "prefisso tag git flow: '$(git config --get gitflow.prefix.versiontag || true)' (se vuoto, la finish va fatta con -T vX.Y.Z e il messaggio con -f <file>)"

echo
echo "== RAMI APERTI"
git for-each-ref --format='%(refname:short)' refs/heads refs/remotes/origin \
  | grep -E '(^|/)(release|hotfix)/' | sed 's#^origin/##' | sort -u || true

echo
echo "== TAG"
echo "ultimo tag stretto raggiungibile da $end: $last"
echo "ultimi tag RC (ordine versionsort):"
gitv tag --sort=-v:refname | grep -E "$RC" | head -8 || true
echo "altri tag (ignorati dallo schema):"
gitv tag --sort=-v:refname | grep -Ev "$SEMVER|$RC" | head -8 || true

echo
echo "== VERSIONE NEI FILE"
echo "package.json: $(grep -m1 -E '"version"' package.json | sed -E 's/.*"version": *"([^"]*)".*/\1/')"
echo "src-tauri/tauri.conf.json: $(grep -m1 -E '"version"' src-tauri/tauri.conf.json | sed -E 's/.*"version": *"([^"]*)".*/\1/')"
echo "Cargo.toml [workspace.package]: $(sed -n '/^\[workspace.package\]/,/^\[/{s/^version *= *"\(.*\)"/\1/p}' Cargo.toml)"

echo
echo "== COMMIT DA $last A $end"
total=$(git rev-list --count "$last..$end" --no-merges)
echo "commit (senza merge): $total"
echo "per tipo:"
git log "$last..$end" --no-merges --format=%s \
  | sed -E 's/^([a-z]+)(\([^)]*\))?(!)?:.*/\1\3/;t;s/.*/altro/' | sort | uniq -c | sort -rn
echo "segnali di breaking change:"
git log "$last..$end" --no-merges --format='%h %s' -E --grep='^[a-z]+(\([^)]*\))?!:' || true
git log "$last..$end" --no-merges --format='%h %s' --grep='BREAKING CHANGE' || true
echo "modifiche al formato delle impostazioni salvate:"
git log "$last..$end" --no-merges --format='%h %s' -- crates/gitpilot-core/src/settings.rs || true

echo
echo "== PROSSIMA VERSIONE (calcolata con tipo di avanzamento a scelta dell'utente)"
IFS=. read -r major minor patch <<<"${last#v}"
echo "major: $((major + 1)).0.0"
echo "minor: $major.$((minor + 1)).0"
echo "patch: $major.$minor.$((patch + 1))"
echo
echo "== RC ESISTENTI PER OGNI CANDIDATA (numero del prossimo RC)"
for v in "$((major + 1)).0.0" "$major.$((minor + 1)).0" "$major.$minor.$((patch + 1))"; do
  maxn=$(git tag -l "v$v-rc.*" | sed -E 's/.*-rc\.//' | sort -n | tail -1)
  echo "$v: prossimo RC = v$v-rc.$(( ${maxn:-0} + 1 ))"
done
