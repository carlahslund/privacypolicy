#!/usr/bin/env bash
# Builds the gym-laptop timer.
#
#   ./build.sh              → build/GracieBarraTimer-vX.Y.Z.exe  (Windows x64)
#   ./build.sh linux        → build/graciebarra-timer            (for testing here)
#
# The web layer is staged into web/ first and baked into the executable, so what
# ships is still a single file the gym copies onto the laptop.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED="$HERE/../shared/web"
BUILD="$HERE/build"
TARGET="${1:-windows}"

VERSION="$(grep -oE 'version *= *"[^"]+"' "$HERE/main.go" | head -1 | cut -d'"' -f2)"

# Stage the shared display, controller, engine and buzzers next to the source.
rm -rf "$HERE/web"
mkdir -p "$HERE/web"
# Kept so the embed directive still compiles in a fresh clone, before anything
# has been staged — `go test ./...` should not need a build first.
touch "$HERE/web/.gitkeep"
cp "$SHARED"/*.js "$SHARED"/*.css "$SHARED"/*.html "$SHARED"/logo.png "$HERE/web/"
cp -r "$SHARED/buzzers" "$HERE/web/"

cd "$HERE"
go vet ./...
go test ./...

mkdir -p "$BUILD"
if [ "$TARGET" = "linux" ]; then
  go build -trimpath -ldflags "-s -w" -o "$BUILD/graciebarra-timer" .
  OUT="$BUILD/graciebarra-timer"
else
  # -H windowsgui would hide the console, but the gym reads the access code out of
  # it, so the window stays — exactly as the 1.2.2 build behaved.
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
    go build -trimpath -ldflags "-s -w" -o "$BUILD/GracieBarraTimer-v$VERSION.exe" .
  OUT="$BUILD/GracieBarraTimer-v$VERSION.exe"
fi

cp "$HERE/README-EXE.txt" "$BUILD/"

echo
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
echo "Ship it alongside $BUILD/README-EXE.txt, as the 1.2.2 zip did." 
