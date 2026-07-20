# Mini-player: playlist variant

Feature folder: `docs/features/20260719134345-mini-player-playlist/`
Branch: `20260719134345-mini-player-playlist`

## Overview

A second mini-player variant. The existing mini (`Mod+Shift+M`) collapses the shell to **only the transport bar** ("bar-mini"). This adds a **"playlist-mini"** variant (`Mod+Shift+L`) that collapses the shell to **the playlist sidebar stacked above the transport bar** - no viewport. Use case: run a music playlist, see the scrollable track list, and drive play/pause/volume/etc from the bar below it.

The two minis plus normal are **three mutually-exclusive modes** (`off | bar | playlist`). Toggling one enters it (leaving the other if active); toggling the active mode returns to normal. Session-only, not persisted (mirrors bar-mini and fullscreen).

## Why

The bar-only mini has no track list, so switching songs means restoring the full window. A playlist-mini keeps the list visible in a compact window while still exposing transport controls.

## Terminology (glossary)

- **miniMode** - the workspace's mini-player state ADT: `"off" | "bar" | "playlist"`. Replaces the old `isMiniPlayer` boolean.
- **bar-mini** - `miniMode === "bar"`. Only the transport bar (existing behaviour). _Avoid_: "mini player" (ambiguous now).
- **playlist-mini** - `miniMode === "playlist"`. Playlist sidebar above the transport bar, no viewport.

## Acceptance Criteria

- AC-001: Workspace exposes a `miniMode` state of type `"off" | "bar" | "playlist"`, defaulting to `"off"`. An `initialMiniMode` provider prop seeds it. (Replaces `isMiniPlayer` / `initialMiniPlayer`.)
- AC-002: `toggleMiniMode("bar")` from `off` enters bar-mini (snapshots current panel visibility, then hides sidebar + keeps transport visible); calling it again from `bar` returns to `off` and restores the snapshot.
- AC-003: `toggleMiniMode("playlist")` from `off` enters playlist-mini (same snapshot + hide-sidebar/keep-transport); calling it again from `playlist` returns to `off` and restores the snapshot.
- AC-004: The modes are mutually exclusive with **direct switch**: `toggleMiniMode("playlist")` while in `bar` goes straight to `playlist` (never through `off`), and vice-versa. The pre-mini snapshot is taken **only** on the `off -> mini` entry and is **preserved** across a direct mini->mini switch (not overwritten).
- AC-005: In playlist-mini, `Content` renders the playlist sidebar (the scrollable media list) **above** the transport bar, with the viewport hidden.
- AC-006: In any mini mode the viewport is hidden via the `hidden` attribute (`display:none`), **never unmounted**, so the inner `<video>` keeps playing (no restart-from-0). Holds across every mode transition including direct bar<->playlist.
- AC-007: `SHORTCUT_ACTIONS` registers a `toggle-mini-playlist` action bound to `Mod+Shift+L` with non-empty name and search keywords; the existing `toggle-mini-player` stays bound to `Mod+Shift+M`; all action ids remain unique.
- AC-008: The `Workspace` handler wires `toggle-mini-playlist` to `toggleMiniMode("playlist")` **and** `setMiniWindow(next)`; the existing bar handler is updated to the new verb. Both compute the next mode from the current `miniMode` (state hasn't flipped at call time).
- AC-009: `setMiniWindow(mode)` resizes the OS window:
  - `"bar"` -> stashed normal **width** x (transport-bar height + title-bar height).
  - `"playlist"` -> `MINI_PLAYLIST_WIDTH` x (transport-bar height + 5-item sidebar height + title-bar height).
  - `"off"` -> restores the stashed normal size.
  - The pre-mini geometry (width, height, title-bar delta) is stashed **once** on the first `off -> mini` entry and reused across direct mini->mini switches (no re-stash); it is cleared on return to `off`.

## Test Cases

- TC-001 (happy, context): default `miniMode` is `off`; `toggleMiniMode("bar")` -> `bar` (sidebar hidden, transport visible); again -> `off`. Maps to: AC-001, AC-002.
- TC-002 (happy, context): `toggleMiniMode("playlist")` -> `playlist`; again -> `off` restoring both panels. Maps to: AC-001, AC-003.
- TC-003 (direct switch, context): enter `bar`, then `toggleMiniMode("playlist")` -> `playlist` (never `off`); then `toggleMiniMode("bar")` -> `bar`. Maps to: AC-004.
- TC-004 (snapshot preserve, context): hide the sidebar in normal, enter `bar`, switch directly to `playlist`, then exit -> the sidebar stays hidden (snapshot from the first entry, not overwritten). Maps to: AC-004.
- TC-005 (render, Content): `initialMiniMode="playlist"` -> a `role="list"` playlist is present in Content, the viewport region is hidden, and a `<video>` mounts and survives. Maps to: AC-005, AC-006.
- TC-006 (render, Content): `initialMiniMode="bar"` -> no playlist list rendered inside Content, viewport hidden, transport bar (play/pause button) present. Maps to: AC-002, AC-006.
- TC-007 (render, Content): `initialMiniMode="off"` -> viewport region visible, no playlist list inside Content. Maps to: AC-005.
- TC-008 (registry): `toggle-mini-playlist` exists, `defaultHotkey === "Mod+Shift+L"`, has >=1 keyword; `toggle-mini-player` still `Mod+Shift+M`; ids unique. Maps to: AC-007.
- TC-009 (mini-window): `setMiniWindow("playlist")` calls `setSize(MINI_PLAYLIST_WIDTH, barHeight + sidebarHeight + titleBar)`; `setMiniWindow("bar")` -> `setSize(stashedWidth, barHeight + titleBar)`; `setMiniWindow("off")` restores the stashed size. Maps to: AC-009.
- TC-010 (mini-window, direct switch): after entering `bar`, switching to `playlist` does **not** re-query `innerSize`/`scaleFactor` (no re-stash); a later `"off"` restores the original stashed size. Maps to: AC-009, AC-004.
- TC-011 (mini-window, edge): `setMiniWindow("off")` with no prior enter is a no-op. Maps to: AC-009.
- TC-012 (edge, Content): playlist-mini with an empty playlist renders the "(no media)" empty state and still shows the transport bar. Maps to: AC-005.

## UI States

| State   | Behavior                                                                                  |
| ------- | ----------------------------------------------------------------------------------------- |
| off     | Normal shell: horizontal sidebar\|viewport split + docked transport bar. Viewport visible. |
| bar     | Window shrinks to the transport bar only (existing). Viewport hidden (mounted).            |
| playlist| Window shrinks to `MINI_PLAYLIST_WIDTH` x (sidebar 5 rows + bar). Sidebar list on top, bar below, viewport hidden (mounted). |
| empty   | playlist-mini with no media: sidebar shows "(no media)", transport bar still rendered.     |

### ASCII wireframes

bar-mini (existing, unchanged):

```
+-------------------------------------+
|[mute][vol]  [<][>][>>]    0:00/0:00 |
+-------------------------------------+
  window = stashed normal width x (bar + titlebar)
```

playlist-mini (new):

```
  <----------- MINI_PLAYLIST_WIDTH ---------->
+-------------------------------------------+
| Sort v                                    |  sidebar header (h-9 = 36px)
+-------------------------------------------+
| 1 - Opening                          MP4  |
| 3 - Intro                            MP4  |  scrollable media
| 9 - Interlude                        MP4  |  list, 5 rows tall
| 12 - Bridge                          MKV  |
| 21 - Finale                          MP4  |
+-------------------------------------------+
|[mute][vol]   [<][>][>>]        0:00/0:00  |  transport bar (48px)
+-------------------------------------------+
  window = MINI_PLAYLIST_WIDTH x (36 + 5*rowH + 48 + titlebar)
```

## Data model

`type MiniMode = "off" | "bar" | "playlist"` and `type MiniTarget = "bar" | "playlist"` in a new shared module `src/lib/mini-mode.ts` (imported by both `workspace-context.tsx` and `lib/tauri.ts` to avoid a components->lib upward import).

Window geometry (in `lib/tauri.ts`, module scope):

- `MINI_PLAYLIST_WIDTH` (px) - the transport bar's intrinsic min width (~680).
- `SIDEBAR_HEADER_HEIGHT` (36 = `h-9`), `MEDIA_ROW_HEIGHT` (~28), `MINI_PLAYLIST_ROWS` (5) -> sidebar height = header + rows*rowH.
- `preMini: { width, height, titleBarHeight } | null` - stashed once on first `off -> mini` entry.

## Edge cases

- Empty playlist in playlist-mini -> "(no media)" empty state, bar still works (TC-012).
- Entering playlist-mini while the sidebar was hidden in normal -> the list still shows (Content renders it from `miniMode`, independent of `isSidebarVisible`); exit restores the hidden snapshot (TC-004).
- Direct bar<->playlist switch -> window geometry stash and panel snapshot both preserved (TC-010, TC-004).
- `<video>` continuity across every transition (AC-006).
- `setMiniWindow` outside a Tauri host -> no-op (existing try/catch).

## Dependencies

None new. Window-resize capabilities (`core:window:allow-set-size` / `allow-inner-size` / `allow-scale-factor`) already present in `src-tauri/capabilities/default.json`.

## Coverage threshold

none (no enforced threshold in vitest config).
