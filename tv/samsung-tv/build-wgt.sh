#!/usr/bin/env bash
# Packages the Samsung TV app.
#
#   ./build-wgt.sh              → build/GracieBarraTimer.wgt, unsigned
#   ./build-wgt.sh <profile>    → signed with that Tizen Studio security profile
#
# A retail Samsung TV will only install a package signed with a certificate issued by
# the Samsung Certificate Extension, so a real install needs the second form. The
# unsigned package is still useful: it is what you hand to Tizen Studio, and its
# contents are exactly what ends up on the TV.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED="$HERE/../shared/web"
BUILD="$HERE/build"
STAGE="$BUILD/package"
PROFILE="${1:-}"

rm -rf "$STAGE"
mkdir -p "$STAGE"

# The display, the engine, the buzzer voices and the ten-foot menu are shared with the
# Android app and with the Windows build; only the shell below is Samsung's.
cp "$SHARED"/*.js "$SHARED"/*.css "$SHARED"/logo.png "$STAGE/"
cp "$HERE/config.xml" "$HERE/icon.png" "$HERE/tizen-shell.js" "$STAGE/"

# Tizen needs two extra tags in the page: the TV's own web APIs, and the shell that
# installs the session engine before boot.js looks for one.
python3 - "$SHARED/index.html" "$STAGE/index.html" <<'PY'
import sys
source, target = sys.argv[1], sys.argv[2]
html = open(source, encoding='utf-8').read()
anchor = '  <script src="boot.js" defer></script>'
inject = (
    '  <script src="$WEBAPIS/webapis/webapis.js"></script>\n'
    '  <script src="tizen-shell.js" defer></script>\n'
)
if anchor not in html:
    raise SystemExit('index.html no longer loads boot.js — update build-wgt.sh')
open(target, 'w', encoding='utf-8').write(html.replace(anchor, inject + anchor))
print('  index.html   (+ webapis, + tizen-shell)')
PY

for file in "$STAGE"/*; do echo "  $(basename "$file")"; done

if [ -n "$PROFILE" ] && command -v tizen >/dev/null 2>&1; then
  echo "Signing with profile '$PROFILE'…"
  tizen package -t wgt -s "$PROFILE" -- "$STAGE"
  mv "$STAGE"/*.wgt "$BUILD/GracieBarraTimer.wgt"
else
  if [ -n "$PROFILE" ]; then
    echo "The 'tizen' CLI is not on PATH — building unsigned instead." >&2
    echo "Add <tizen-studio>/tools/ide/bin to PATH to sign." >&2
  fi
  ( cd "$STAGE" && zip -q -r -X "$BUILD/GracieBarraTimer.wgt" . )
fi

echo
echo "Built $BUILD/GracieBarraTimer.wgt ($(du -h "$BUILD/GracieBarraTimer.wgt" | cut -f1))"
if [ -z "$PROFILE" ]; then
  echo "Unsigned. To install on a TV, sign it first:"
  echo "  ./build-wgt.sh <your-security-profile>"
fi
