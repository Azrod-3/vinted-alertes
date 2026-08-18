#!/usr/bin/env bash
# Enregistre l'etat dans le depot, en le fusionnant avec ce qui s'y trouve deja.
#
# On ne demande pas a git de fusionner ce JSON : il n'y arrive pas et l'etape
# echouait, ce qui faisait perdre l'etat et realerter tout. On repart de la
# version du depot et on y verse la notre.
#
# Appele par le scan toutes les quinze minutes (un job dure cinq heures, tout
# perdre en cas d'interruption serait absurde) et une derniere fois a la fin.
set -uo pipefail
cd "$(dirname "$0")"

# Ce script fait un `git reset --hard` : sur une machine de developpement il
# effacerait le travail en cours. Il ne doit tourner que sur un runner, dont
# l'arbre est de toute facon jetable. (Appris a mes depens.)
if [ -z "${GITHUB_ACTIONS:-}" ]; then
  echo "enregistrer-etat.sh ne doit tourner que sur GitHub Actions — abandon." >&2
  exit 0
fi

temporaire="${RUNNER_TEMP:-/tmp}/etat-local.json"
cp etat.json "$temporaire" || exit 0

git config user.name "veille-vinted"
git config user.email "actions@github.com"

for essai in 1 2 3; do
  git fetch -q origin main || exit 0
  git reset -q --hard origin/main
  node fusionner-etat.mjs "$temporaire" etat.json >/dev/null
  git add etat.json
  if git diff --cached --quiet; then
    echo "état : rien de nouveau à enregistrer"
    exit 0
  fi
  git commit -q -m "veille : mise à jour de l'état"
  if git push -q origin HEAD:main 2>/dev/null; then
    echo "état enregistré (essai $essai)"
    exit 0
  fi
  echo "état : poussée refusée, le dépôt a bougé — nouvelle tentative"
done
echo "::warning::état non enregistré après 3 essais"
