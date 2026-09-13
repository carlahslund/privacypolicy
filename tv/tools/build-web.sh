#!/usr/bin/env bash
# Builds the browser version of the timer into /timer at the repository root.
#
#   ./build-web.sh          → rebuild it
#   ./build-web.sh --check  → fail if the checked-in copy is stale (used by CI)
#
# This is the version any smart TV can run without installing anything: open the TV's
# own browser at the published address and the whole timer is there, session engine
# and all. It is checked in because GitHub Pages serves the branch as it stands.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED="$HERE/../shared/web"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/timer"
MODE="${1:-}"

if [ "$MODE" = "--check" ]; then
  TARGET="$(mktemp -d)"
  trap 'rm -rf "$TARGET"' EXIT
else
  TARGET="$OUT"
  rm -rf "$TARGET"
fi
mkdir -p "$TARGET"

cp "$SHARED"/*.js "$SHARED"/*.css "$SHARED"/logo.png "$TARGET/"

python3 - "$SHARED/index.html" "$TARGET/index.html" <<'PY'
import sys
source, target = sys.argv[1], sys.argv[2]
html = open(source, encoding='utf-8').read()
anchor = '  <script src="boot.js" defer></script>'
if anchor not in html:
    raise SystemExit('index.html no longer loads boot.js — update build-web.sh')
html = html.replace(anchor, '  <script src="tv-shell.js" defer></script>\n' + anchor)
open(target, 'w', encoding='utf-8').write(html)
PY

if [ "$MODE" = "--check" ]; then
  if diff -r -q "$TARGET" "$OUT" >/dev/null 2>&1; then
    echo "/timer is up to date."
  else
    echo "/timer is stale — run tv/tools/build-web.sh and commit the result." >&2
    diff -r -q "$TARGET" "$OUT" >&2 || true
    exit 1
  fi
else
  echo "Built $OUT:"
  for file in "$TARGET"/*; do echo "  $(basename "$file")"; done
fi
