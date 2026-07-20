# 20260720181300-auto-update | In-app auto-update (Tauri updater)

Feature branch: `20260720181300-auto-update`
(Personal repo - no Jira. Origin: `piotrzielinski1994/pureplayer`.)

Mirrors the `purerequest` auto-update feature (`20260719141621-auto-update`)
verbatim in shape, adapted to pureplayer's structure (no toast component yet, no
`isDevBrowser` helper, plain Settings route instead of a tab strip).

## Overview

Add real in-place auto-update so a user who installed a release build gets new
versions without a manual uninstall/reinstall. Uses the official Tauri v2 updater
plugin: the app checks a GitHub-hosted `latest.json` on startup (and via a manual
button in Settings), and on finding a newer version shows a **persistent toast**
the user must dismiss themselves; the toast carries an **"Update now"** button
that downloads the signed artifact (with progress) and relaunches.

Enabled on all three OSes (macOS, Windows, Linux). Signing keypair generated
locally; private key + password stored as GitHub repo secrets (never committed).

**Hard truth up front:** the currently-installed v0.1.0 (a draft, pre-updater)
has no updater and therefore cannot auto-update. Auto-update only works *forward*
from the first updater-enabled release. That first build is still a manual
download.

## Acceptance Criteria

- AC-001: On app startup (native build only), the app checks the update endpoint
  exactly once. If no update or the check errors, nothing is shown and the app
  behaves exactly as today (no toast, no error surfaced to the user).
- AC-002: When a newer version is found, a toast appears reading
  `Update available: vX.Y.Z` with an **Update now** button and a **dismiss**
  (×) control. The toast is **persistent** - it does NOT auto-expire.
- AC-003: Clicking **Update now** downloads and installs the update, showing
  progress (`Downloading… NN%`) in place of the button, then relaunches the app.
- AC-004: Settings has a new **Updates** section showing the current app version
  and a **Check for updates** button. Clicking it runs the same check on demand;
  result is surfaced (update-available toast, or a `You're on the latest version`
  toast, or a `Update check failed` toast on error).
- AC-005: The manual **Check for updates** button shows a busy/disabled state
  while a check is in flight and cannot be double-fired.
- AC-006: The updater plugin, its permission, and signing config are wired so a
  release built by the CI workflow produces updater artifacts (`.sig` files) and
  publishes a `latest.json` that the app can consume.
- AC-007: In the dev browser and in jsdom tests (non-Tauri), the update check is
  a no-op (injected noop controller); no network call, no crash.

## Test Cases

- TC-001 (happy, startup): native env, controller reports update `v0.2.0` -> persistent toast with version + button. Maps to: AC-001, AC-002.
- TC-002 (happy, no update): controller reports no update -> no toast. Maps to: AC-001.
- TC-003 (error, startup): `check()` rejects -> error swallowed, no toast, no throw. Maps to: AC-001.
- TC-004 (happy, install): click Update now -> `downloadAndInstall` with progress callback -> label updates -> `relaunch`. Maps to: AC-003.
- TC-005 (persistence): update toast rendered -> advance past 2500ms -> still present. Maps to: AC-002.
- TC-006 (dismiss): click × -> toast removed, no install. Maps to: AC-002.
- TC-007 (manual, latest): Settings, Check -> no update -> `latest version` toast + button idle. Maps to: AC-004, AC-005.
- TC-008 (manual, available): Check -> update found -> update toast. Maps to: AC-004.
- TC-009 (manual, error): Check -> `check()` rejects -> `Update check failed` toast + button idle. Maps to: AC-004, AC-005.
- TC-010 (manual, in-flight): Check -> before resolve, button disabled, second click no-op. Maps to: AC-005.
- TC-011 (version display): Updates section renders current version from injected source. Maps to: AC-004.
- TC-012 (noop env): non-Tauri env uses noop controller -> `check()` resolves null without any Tauri API. Maps to: AC-007.

## UI States

Update toast (persistent, bottom-right, matches new toast styling):

| State       | Behavior                                                       |
| ----------- | -------------------------------------------------------------- |
| Available   | `Update available: vX.Y.Z` + [Update now] button + [×] dismiss |
| Downloading | button replaced by `Downloading… NN%` (from progress events)   |
| Dismissed   | toast removed from stack; no further action                    |

Settings > Updates section:

| State      | Behavior                                                     |
| ---------- | ------------------------------------------------------------ |
| Idle       | shows `Current version: X.Y.Z` + [Check for updates] button  |
| Checking   | button disabled + label `Checking…`; second click no-op      |
| Up-to-date | toast `You're on the latest version`; button back to idle    |
| Available  | update toast shown (same as startup path); button back to idle |
| Error      | toast `Update check failed`; button back to idle             |

## Data Model

`UpdateInfo` ADT: `{ version, downloadAndInstall(onProgress), relaunch }`.
`UpdateController` port: `{ check(): Promise<UpdateInfo | null> }`.

## Edge Cases

- Update check error on startup -> swallowed, silent (AC-001/TC-003).
- Manual check error -> toast + button un-sticks (AC-005/TC-009).
- Double-click manual check -> in-flight guard (AC-005/TC-010).
- Non-Tauri env -> noop controller, zero network (AC-007/TC-012).
- Persistent toast must not inherit the 2500ms auto-dismiss (TC-005).
- Download `contentLength` may be absent -> guard divide-by-zero, no `NaN%`.

## Dependencies

- `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` (JS).
- `tauri-plugin-updater` (rustls-tls), `tauri-plugin-process` (Cargo).
- CI secrets `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` (already set 2026-07-20).
- Public key baked into `tauri.conf.json`.
