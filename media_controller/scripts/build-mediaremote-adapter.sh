#!/usr/bin/env bash
#
# Builds ungive/mediaremote-adapter (BSD-3-Clause) from source and vendors the
# result into the plugin so the macOS bridge is self-contained.
#
# Output: com.sonky.media-controller.sdPlugin/vendor/mediaremote-adapter/
#   - mediaremote-adapter.pl
#   - MediaRemoteAdapter.framework  (universal x86_64 + arm64, ad-hoc signed, FLAT layout)
#   - LICENSE, README.md
#
# The framework is deliberately NOT a versioned bundle (no Versions/A, no symlinks):
# `streamdeck pack` drops the framework's top-level `MediaRemoteAdapter` symlink from the
# .streamDeckPlugin archive, and that is the exact path mediaremote-adapter.pl dlopens — a
# packaged plugin then fails with "Failed to load framework" while a `streamdeck link`ed
# working tree keeps working. Real files survive packing; symlinks do not.
#
# Requirements: git, Xcode Command Line Tools (clang). CMake is NOT needed —
# the framework is compiled directly with clang.
#
# Usage: scripts/build-mediaremote-adapter.sh [git-tag]   (default: v0.7.6)

set -euo pipefail

TAG="${1:-v0.7.6}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$HERE/.." && pwd)"
VENDOR="$PLUGIN_DIR/com.sonky.media-controller.sdPlugin/vendor/mediaremote-adapter"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ cloning ungive/mediaremote-adapter@$TAG"
git clone --depth 1 --branch "$TAG" https://github.com/ungive/mediaremote-adapter.git "$WORK/src" >/dev/null 2>&1
cd "$WORK/src"
COMMIT="$(git rev-parse --short HEAD)"

FW="$WORK/out/MediaRemoteAdapter.framework"
mkdir -p "$FW/Resources"

echo "→ compiling universal framework (clang)"
clang -dynamiclib -fobjc-arc -fvisibility=default \
  -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 \
  -Iinclude -Isrc \
  -framework Foundation -framework AppKit -framework UniformTypeIdentifiers \
  -install_name @rpath/MediaRemoteAdapter.framework/MediaRemoteAdapter \
  -current_version 0.1.0 -compatibility_version 0.1.0 \
  -o "$FW/MediaRemoteAdapter" \
  src/adapter/env.m src/adapter/get.m src/adapter/globals.m src/adapter/keys.m \
  src/adapter/now_playing.m src/adapter/repeat.m src/adapter/seek.m src/adapter/send.m \
  src/adapter/shuffle.m src/adapter/speed.m src/adapter/stream.m src/adapter/test.m \
  src/private/MediaRemote.m src/utility/Debounce.m src/utility/helpers.m

cat > "$FW/Resources/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>MediaRemoteAdapter</string>
  <key>CFBundleIdentifier</key><string>com.vandenbe.MediaRemoteAdapter</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>MediaRemoteAdapter</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
</dict></plist>
PLIST
echo "→ ad-hoc codesign"
# Sign the Mach-O itself, not the enclosing directory: dlopen validates the embedded
# signature, and a flat *.framework directory is not a bundle codesign can reason about.
codesign --force --sign - "$FW/MediaRemoteAdapter" >/dev/null 2>&1

echo "→ vendoring into $VENDOR"
rm -rf "$VENDOR"; mkdir -p "$VENDOR"
cp "$WORK/src/bin/mediaremote-adapter.pl" "$VENDOR/mediaremote-adapter.pl"
cp "$WORK/src/LICENSE" "$VENDOR/LICENSE"
cp -R "$FW" "$VENDOR/MediaRemoteAdapter.framework"
cat > "$VENDOR/README.md" <<MD
# Vendored: mediaremote-adapter

- Source: https://github.com/ungive/mediaremote-adapter
- Version: $TAG (commit $COMMIT)
- License: BSD-3-Clause (see LICENSE)

\`MediaRemoteAdapter.framework\` is built from source by
\`scripts/build-mediaremote-adapter.sh\` (clang, universal x86_64+arm64, ad-hoc signed).
Its layout is flat on purpose — a versioned bundle's symlinks do not survive
\`streamdeck pack\`, and the top-level binary path is what the perl script dlopens.

Used out-of-process via \`/usr/bin/perl mediaremote-adapter.pl <framework> <get|stream|send ...>\`
to read now-playing info and send media commands on macOS 15.4+, where in-process
MediaRemote access is blocked.
MD

echo "→ verifying"
# `get` (not `test`): the vendored .pl wants a MediaRemoteAdapterTestClient path for `test`,
# which is not part of this vendor tree. `get` exercises the same dlopen + MediaRemote call and
# prints `null` when nothing is playing — a successful exit is the signal, not the payload.
/usr/bin/perl "$VENDOR/mediaremote-adapter.pl" "$VENDOR/MediaRemoteAdapter.framework" get >/dev/null \
  && echo "✔ adapter functional (framework loaded, MediaRemote reachable)" \
  || { echo "✖ adapter check failed"; exit 1; }
echo "✔ done"
