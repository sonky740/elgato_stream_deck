#!/usr/bin/env bash
#
# Builds ungive/mediaremote-adapter (BSD-3-Clause) from source and vendors the
# result into the plugin so the macOS bridge is self-contained.
#
# Output: com.sonky.media-controller.sdPlugin/vendor/mediaremote-adapter/
#   - mediaremote-adapter.pl
#   - MediaRemoteAdapter.framework  (universal x86_64 + arm64, ad-hoc signed)
#   - LICENSE, README.md
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

FW="$WORK/out/MediaRemoteAdapter.framework"
mkdir -p "$FW/Versions/A/Resources"

echo "→ compiling universal framework (clang)"
clang -dynamiclib -fobjc-arc -fvisibility=default \
  -arch arm64 -arch x86_64 -mmacosx-version-min=12.0 \
  -Iinclude -Isrc \
  -framework Foundation -framework AppKit -framework UniformTypeIdentifiers \
  -install_name @rpath/MediaRemoteAdapter.framework/Versions/A/MediaRemoteAdapter \
  -current_version 0.1.0 -compatibility_version 0.1.0 \
  -o "$FW/Versions/A/MediaRemoteAdapter" \
  src/adapter/env.m src/adapter/get.m src/adapter/globals.m src/adapter/keys.m \
  src/adapter/now_playing.m src/adapter/repeat.m src/adapter/seek.m src/adapter/send.m \
  src/adapter/shuffle.m src/adapter/speed.m src/adapter/stream.m src/adapter/test.m \
  src/private/MediaRemote.m src/utility/Debounce.m src/utility/helpers.m

cat > "$FW/Versions/A/Resources/Info.plist" <<'PLIST'
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
ln -sfn A "$FW/Versions/Current"
ln -sfn Versions/Current/MediaRemoteAdapter "$FW/MediaRemoteAdapter"
ln -sfn Versions/Current/Resources "$FW/Resources"

echo "→ ad-hoc codesign"
codesign --force --deep --sign - "$FW" >/dev/null 2>&1

echo "→ vendoring into $VENDOR"
rm -rf "$VENDOR"; mkdir -p "$VENDOR"
cp "$WORK/src/bin/mediaremote-adapter.pl" "$VENDOR/mediaremote-adapter.pl"
cp "$WORK/src/LICENSE" "$VENDOR/LICENSE"
cp -R "$FW" "$VENDOR/MediaRemoteAdapter.framework"
cat > "$VENDOR/README.md" <<MD
# Vendored: mediaremote-adapter

- Source: https://github.com/ungive/mediaremote-adapter
- Version: $TAG
- License: BSD-3-Clause (see LICENSE)

\`MediaRemoteAdapter.framework\` is built from source by
\`scripts/build-mediaremote-adapter.sh\` (clang, universal x86_64+arm64, ad-hoc signed).

Used out-of-process via \`/usr/bin/perl mediaremote-adapter.pl <framework> <get|stream|send ...>\`
to read now-playing info and send media commands on macOS 15.4+, where in-process
MediaRemote access is blocked.
MD

echo "→ verifying"
/usr/bin/perl "$VENDOR/mediaremote-adapter.pl" "$VENDOR/MediaRemoteAdapter.framework" test \
  && echo "✔ adapter functional (entitlement test passed)" \
  || { echo "✖ entitlement test failed"; exit 1; }
echo "✔ done"
