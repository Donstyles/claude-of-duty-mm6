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

echo "[queue] lock acquired, starting capture" >&2
node "$ROOT/tools/shoot.mjs" "$@"
