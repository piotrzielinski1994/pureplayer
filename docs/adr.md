# Architectural Decisions - vidui

Append-only log of architectural and design decisions made during development.

## Format

Each entry follows this structure:

| Date | Decision | Rationale |
|------|----------|-----------|
| {YYYY-MM-DD} | {What was decided} | {Why this choice was made} |

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-19 | Bootstrap stack = Tauri 2 + React 19/TS + Vite + TanStack Router/Query/Hotkeys + shadcn/Tailwind v4 + Vitest. Mirrors sibling repo `requi` but **drops TanStack Table & Form**. | A video player is keyboard-driven (Hotkeys), needs routing (Router) and async/IPC state (Query), but has no data-grid or multi-field-form surface. Carrying Table/Form would be unused deps (YAGNI). Add them only when a feature needs them. |
| 2026-06-19 | Code-based TanStack routes (not file-based). | Fewer build plugins; matches `requi`. |
| 2026-06-19 | Pure scaffold - no real `<video>` playback in bootstrap. | Keeps bootstrap = tooling foundation only; first playback feature lands separately so scaffold and feature concerns stay unmixed. |
