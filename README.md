# pureplayer

A minimal, keyboard-driven desktop video player.

Built as a Tauri 2 desktop app with a React 19 + TypeScript frontend on the TanStack
stack (Router, Query, Hotkeys) and shadcn/ui + Tailwind v4.

## Prerequisites

- **Node.js** - version pinned in [.nvmrc](.nvmrc). Run `nvm use` before any npm command.
- **Rust** stable toolchain (`rustc`, `cargo`).
- **Tauri OS prerequisites** - platform-specific system libraries (WebKitGTK on Linux,
  Xcode CLT on macOS, WebView2 + Build Tools on Windows). See
  https://tauri.app/start/prerequisites/

If the Rust toolchain or system prerequisites are missing, `npm start` fails fast with
a build error from Cargo.

## Setup

```bash
nvm use
npm install
scripts/fetch-ffmpeg.sh   # download the bundled ffmpeg/ffprobe sidecars (required before any build)
```

`scripts/fetch-ffmpeg.sh` downloads statically-linked `ffmpeg`+`ffprobe` for all
supported targets (macOS arm64/x64, Windows x64, Linux x64) into `src-tauri/binaries/`
(gitignored, SHA-256 pinned). `cargo` fails to build without the binary for your host
triple present. macOS binaries are GPLv3, Windows and Linux are LGPLv3 - see [docs/adr.md](docs/adr.md).

## Commands

| Command | Description |
| --- | --- |
| `npm start` | Launch the desktop app (`tauri dev`) - native window + Vite dev server. |
| `npm run dev` | Frontend-only Vite dev server (browser, no native shell). |
| `npm run build` | Typecheck + production frontend build (`dist/`). |
| `npm run tauri build` | Produce a native desktop bundle. |
| `npm run lint` | Biome check (lint + format + import sort). |
| `npm run lint:fix` | Biome check with safe autofixes applied. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run format` | Biome format write. |
| `npm test` | Frontend behavior tests (Vitest, run once). |
| `npm run test:watch` | Vitest in watch mode. |

Rust backend tests: `cd src-tauri && cargo test`.

## Features

- **Playlist** - flat sidebar of the open files; `Open files` (`Mod+O`) replaces it, drag & drop
  appends (folders recursed, deduped, sorted). Audio files are first-class playlist items.
- **Universal playback** - every file is probed (ffprobe) and a playback strategy is chosen so the
  picture is instant and seeking is native: native-codec files play directly, others are stream-copied
  into a finished MP4, play with a background audio re-encode, or fall back to play-while-encode HLS.
  `ffmpeg`/`ffprobe` are bundled as Tauri sidecars - the app is standalone.
- **Transport** - prev/play-pause/next, seekable progress bar (click or drag), arrows seek ±5s
  (Shift ±1s), `Up`/`Down`/`M` volume + mute, `[`/`]` speed 0.5x-2x, auto-advance with repeat (`R`)
  and shuffle (`S`).
- **Viewport** - single-click play/pause, double-click / F11 / green button fullscreen, rotate
  (`Mod+Shift+R`), fit modes (`F`), zoom (`=`/`-`), reset (`Mod+0`). Transforms are session-sticky.
- **Command palette** (`Mod+K`) - every runnable action, each with its own global hotkey.
- **Mini player** (`Mod+Shift+M`) - hide the viewport and shrink the window to just the playlist +
  transport bar.
- **Settings** (`Mod+,`) - rebind any hotkey (conflicts rejected), playback/UI defaults, theme
  (light/dark/system + per-token color customization), reveal-transport-on-hover toggle.
- **Auto-update** - see below.

Not yet: subtitles, playlist persistence.

## Releasing installers

The [`Release` workflow](.github/workflows/release.yml) builds installers for all three OSes and
publishes them to a GitHub Release. It is **manual only**: GitHub -> Actions -> "Release" -> "Run
workflow", enter a tag (e.g. `v0.1.0`). It produces a single universal macOS `.dmg`, a Windows
installer, and a Linux `.AppImage`, attached to a **draft** Release. The binaries are **unsigned**:
on macOS right-click the app and choose Open; on Windows choose "More info -> Run anyway".

To take installers down later, delete the Release (and its tag) or remove individual assets - the
download links 404 immediately. Anyone who already downloaded keeps their local copy.

### In-app auto-update

Release builds ship the Tauri v2 updater: on startup (and via **Settings -> Updates -> Check for
updates**) the app checks the latest GitHub Release's `latest.json` and, on a newer version, offers
a one-click **Update now** that downloads the signed artifact and relaunches. Update artifacts
(`.sig` files + `latest.json`) are produced by the `Release` workflow, which signs them using two
repo secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the matching
public key is baked into `src-tauri/tauri.conf.json`). **Caveat:** a build can only auto-update to
releases published *after* it - the first updater-enabled release is still a manual download, and
the pre-updater v0.1.0 cannot retro-update.

## Repo layout

```
src/                    React app: main entry, router, routes, components, lib
src-tauri/              Rust desktop shell: media.rs (ffprobe/ffmpeg prepare_media via bundled
                        sidecars), hls_server.rs (loopback HTTP server), import.rs (drag-drop),
                        focus.rs, logging.rs (per-launch log file), binaries/ (gitignored sidecars)
scripts/                fetch-ffmpeg.sh (download bundled ffmpeg/ffprobe sidecars)
tests/e2e/              Behavior smoke tests
docs/                   spec/plan per feature, ADR, learnings
```

Each launch writes a fresh `pureplayer-<ts>.log` to the OS app-log dir (macOS
`~/Library/Logs/com.pzielinski.pureplayer/`).