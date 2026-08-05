# Vendored: mediaremote-adapter

- Source: https://github.com/ungive/mediaremote-adapter
- Version: v0.7.6 (commit 3ac3d4b)
- License: BSD-3-Clause (see LICENSE)

`MediaRemoteAdapter.framework` is built from source by
`scripts/build-mediaremote-adapter.sh` (clang, universal x86_64+arm64, ad-hoc signed).
Its layout is flat on purpose — a versioned bundle's symlinks do not survive
`streamdeck pack`, and the top-level binary path is what the perl script dlopens.

Used out-of-process via `/usr/bin/perl mediaremote-adapter.pl <framework> <get|stream|send ...>`
to read now-playing info and send media commands on macOS 15.4+, where in-process
MediaRemote access is blocked.
