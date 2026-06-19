# Learnings

Project-specific conventions, gotchas, and constraints worth recording so future-you (human or agent) doesn't re-derive them. Append-only. For architectural trade-offs use [adr.md](adr.md) instead.

## Entries

<!-- Format: one bullet per learning. Date prefix optional. -->

- `nvm` on this machine is shimmed to print "use `mise` instead" and does nothing; node is managed by mise (`.nvmrc` pins 24, mise has 24.17.0). In non-interactive bash, activate first: `eval "$(mise activate bash)"` then `mise exec -- <cmd>` to get node 24.
- TanStack Hotkeys: `@tanstack/react-hotkeys` provides the React `useHotkeys` + `HotkeysProvider` (the framework-agnostic core is the separate `@tanstack/hotkeys`). Hotkey strings are case-sensitive uppercase, e.g. `"Mod+K"`. Under jsdom the lib resolves `Mod` to `Control` (test platform reports non-mac), so hotkey tests fire `{Control>}k{/Control}`, not Meta.
- shadcn Button keeps `react-refresh/only-export-components` as an accepted lint *warning* (the canonical upstream file exports `buttonVariants` alongside the component). Lint exits 0 with that one warning.
