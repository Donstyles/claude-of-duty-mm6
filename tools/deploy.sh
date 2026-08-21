#!/usr/bin/env bash
# Publish the built game to the `gh-pages` branch.
#
# GitHub Pages is serving this repository from a branch, not from the Actions
# artifact — `.github/workflows/pages.yml` exists and cannot switch the source
# on, because turning Pages on is an admin action and `GITHUB_TOKEN` is not an
# admin. So the branch is the deploy, and this is it.
#
# The branch is a single orphan commit, replaced whole each time. There is no
# history worth keeping in a build artefact, and a fresh orphan is what makes
# a deploy idempotent: whatever is in `dist/` becomes exactly what is served,
# with no chance of a file from a previous build surviving into the new one and
# being fetched by a stale index.
#
# The build happens inside the capture lock. Several agents run `npm run check`
# in this same checkout and each of those rewrites `dist/` with new
# content-hashed chunk names; deploying across one of those is how you ship an
# `index.html` that asks for chunks nobody uploaded.
#
#   bash tools/deploy.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
WORK="$(mktemp -d)"
trap 'rm -rf "$STAGE" "$WORK"; git -C "$ROOT" worktree prune' EXIT

cd "$ROOT"

echo "[deploy] building (queued behind any running capture)"
flock -w 1800 /tmp/mm6-capture.lock npx vite build --logLevel error

# `.nojekyll` or Pages runs the output through Jekyll, which silently drops
# every directory beginning with an underscore.
cp -r dist/. "$STAGE"/
touch "$STAGE/.nojekyll"
echo "[deploy] $(du -sh "$STAGE" | cut -f1) to publish, $(find "$STAGE" -type f | wc -l) files"

rm -rf "$WORK"
git worktree add -f --detach "$WORK" HEAD >/dev/null 2>&1
cd "$WORK"
# `-B`-style: a leftover `publish` from an interrupted run must not stop the
# next deploy. The branch is scratch, recreated from nothing every time.
git branch -D publish >/dev/null 2>&1 || true
git checkout -q --orphan publish
git rm -rq --cached . >/dev/null 2>&1 || true
find "$WORK" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -r "$STAGE"/. "$WORK"/
git add -A
git -c user.email=roflchopper1337@gmail.com -c user.name=Claude \
  commit -q -m "Publish the built game."

# Force, and force is correct here: the branch is an artefact, not a history,
# and every publish replaces it whole.
for delay in 2 4 8 16 0; do
  if git push -f origin publish:gh-pages 2>&1 | tail -2; then break; fi
  [ "$delay" = 0 ] && { echo "[deploy] push failed"; exit 1; }
  echo "[deploy] push failed, retrying in ${delay}s"
  sleep "$delay"
done

cd "$ROOT"
echo "[deploy] https://donstyles.github.io/claude-of-duty-mm6/"
