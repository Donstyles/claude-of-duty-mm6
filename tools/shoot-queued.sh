#!/usr/bin/env bash
# Serialise screenshot runs across concurrent agents.
#
# `shoot.mjs` boots a Vite build and a headless Chromium doing software
# rasterisation. One of those is fine on this box. Seven at once is not: with
# several agents working in parallel the load average hit 156 on four cores,
# 70 Chromium processes deep, and every capture slowed to the point where the
# shot timeout became the binding constraint rather than the render.
#
# The fix is a queue, not politeness. This takes an exclusive lock, runs the
# capture, and releases it, so N agents calling it at once get N sequential
# captures instead of N simultaneous ones. Total wall-clock is roughly the
# same; the difference is that the captures finish instead of timing out.
#
#   tools/shoot-queued.sh ui-shop --out shots/x --width 1200 --height 900
#
# Every argument is passed straight through to tools/shoot.mjs.
#
# The wait is unbounded on purpose. A capture that queues for ten minutes and
# then succeeds is worth far more than one that starts immediately, fights six
# others for a core, and dies at the timeout with nothing to show.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="${TMPDIR:-/tmp}/mm6-capture.lock"

exec 9>"$LOCK"

if ! flock -n 9; then
  echo "[queue] another capture is running; waiting for the lock…" >&2
  flock 9
fi

echo "[queue] lock acquired" >&2

# The build goes INSIDE the lock, and that placement is the whole point.
#
# It was outside, so a red tree could be caught without spending a slot. That
# was worth having and it cost something worse: `vite build` rewrites `dist/`
# with content-hashed chunk names, and `shoot.mjs` serves `dist/` for the whole
# of a capture. So one agent's pre-flight, running outside the lock, could
# rename the chunks under another agent's running capture — which failed as
# `HTTP 404 …/assets/WeatherSystem-<hash>.js`, a error that looks like a broken
# import and is nothing of the kind.
#
# Serialising captures is pointless if the artefact they serve is shared and
# mutable. One writer at a time, and the writer is whoever holds the lock.
echo "[queue] building…" >&2
if ! BUILD_LOG="$(cd "$ROOT" && npx vite build --logLevel error 2>&1)"; then
  echo "[queue] TREE IS RED — nothing to capture." >&2
  echo "$BUILD_LOG" | tail -20 >&2
  echo "[queue] This is very likely another agent mid-save rather than your" >&2
  echo "[queue] change. Wait a minute and run this again; if it persists, the" >&2
  echo "[queue] file named above tells you who to tell." >&2
  exit 2
fi

echo "[queue] starting capture" >&2
node "$ROOT/tools/shoot.mjs" "$@"
