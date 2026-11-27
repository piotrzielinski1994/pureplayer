#!/usr/bin/env bash
# Download the Windows libmpv runtime that tauri-plugin-libmpv loads at startup
# (libmpv-wrapper.dll + libmpv-2.dll) into src-tauri/lib/. tauri.windows.conf.json
# bundles that folder as resources, so the installer puts the DLLs in <install>/lib/,
# one of the folders the plugin searches.
#
# Files are NOT committed (src-tauri/lib/ is gitignored). Run this once locally and
# in CI before a Windows `npm start` / `npm run tauri build`.
#
# Source: a pureplayer mirror release, because zhongfly/mpv-winbuild prunes its
# dated tags after about 30 days. libmpv-2.dll = mpv-dev-lgpl-x86_64-20261127-git-1eab28e7b5,
# libmpv-wrapper.dll = nini22P/libmpv-wrapper v0.1.1 (windows-x86_64).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="$ROOT_DIR/src-tauri/lib"
MIRROR="https://github.com/piotrzielinski1994/pureplayer/releases/download/libmpv-windows-20261127"

sha256_for() {
  case "$1" in
    libmpv-2.dll)       echo "829d3598c4aa6d0bf604e126dc14ffa963925a049ee7b019d5185aef1e0bac7c" ;;
    libmpv-wrapper.dll) echo "0d5adead5f175c55e0790a80924ec0a2636f72e3675c79a6d9d9568b2ed2384a" ;;
  esac
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

mkdir -p "$LIB_DIR"
for name in libmpv-2.dll libmpv-wrapper.dll; do
  dest="$LIB_DIR/$name"
  if [ -f "$dest" ] && [ "$(sha256_of "$dest")" = "$(sha256_for "$name")" ]; then
    echo "$name: present, skipping"
    continue
  fi
  echo "$name: downloading"
  curl -fsSL "$MIRROR/$name" -o "$dest.part"
  got="$(sha256_of "$dest.part")"
  if [ "$got" != "$(sha256_for "$name")" ]; then
    echo "  ERROR: checksum mismatch for $name (got $got)" >&2
    rm -f "$dest.part"
    exit 1
  fi
  mv "$dest.part" "$dest"
  echo "  placed $name"
done

echo "done -> $LIB_DIR"
