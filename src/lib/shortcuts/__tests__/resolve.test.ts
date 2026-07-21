import { describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import {
  findConflict,
  resolveShortcuts,
  safeNormalize,
} from "@/lib/shortcuts/resolve";

// Pick two real actions with distinct default bindings for the conflict tests,
// derived dynamically so the tests survive id/binding changes in the registry.
const distinctPair = (() => {
  for (const owner of SHORTCUT_ACTIONS) {
    const other = SHORTCUT_ACTIONS.find(
      (a) => a.id !== owner.id && a.defaultHotkey !== owner.defaultHotkey,
    );
    if (other) {
      return { owner, other };
    }
  }
  throw new Error("registry needs two actions with distinct bindings");
})();

describe("safeNormalize", () => {
  // behavior: a valid hotkey is returned in normalized form (AC-011, TC-013)
  it("should return a normalized string if the input is a valid hotkey", () => {
    expect(safeNormalize("Mod+J")).toBe("Mod+J");
  });

  // behavior: lower-case modifier+key canonicalizes to the uppercase form (AC-011, TC-013)
  it("should canonicalize a lower-case modifier+key into the uppercase form", () => {
    expect(safeNormalize("mod+j")).toBe("Mod+J");
  });

  // behavior: garbage input is rejected with null (AC-011, E-4)
  it("should return null if the input is garbage", () => {
    expect(safeNormalize("not a hotkey!!")).toBeNull();
  });

  // behavior: empty input is rejected with null (AC-011, E-4)
  it("should return null if the input is an empty string", () => {
    expect(safeNormalize("")).toBeNull();
  });
});

describe("resolveShortcuts", () => {
  // behavior: with no overrides every action resolves to its registry default (AC-011, TC-013)
  it("should return every action's registry default if no overrides are given", () => {
    const effective = resolveShortcuts({});

    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toBe(action.defaultHotkey);
    });
  });

  // behavior: a valid override replaces only that action's default, leaving the rest (AC-011, TC-013)
  it("should return the override for toggle-play and defaults elsewhere", () => {
    const effective = resolveShortcuts({ "toggle-play": "Mod+P" });

    expect(effective["toggle-play"]).toBe("Mod+P");
    SHORTCUT_ACTIONS.filter((a) => a.id !== "toggle-play").forEach((action) => {
      expect(effective[action.id]).toBe(action.defaultHotkey);
    });
  });

  // behavior: an unparseable override string falls back to the default (AC-011, TC-013, E-4)
  it("should fall back to the default if an override is an invalid hotkey string", () => {
    const overrides: ShortcutOverrides = { "toggle-play": "bogus!!" };
    const def = SHORTCUT_ACTIONS.find(
      (a) => a.id === "toggle-play",
    )!.defaultHotkey;

    expect(resolveShortcuts(overrides)["toggle-play"]).toBe(def);
  });

  // behavior: a non-string override value falls back to the default (AC-011, E-2)
  it("should fall back to the default if an override value is not a string", () => {
    const overrides = {
      "toggle-play": 42,
    } as unknown as ShortcutOverrides;
    const def = SHORTCUT_ACTIONS.find(
      (a) => a.id === "toggle-play",
    )!.defaultHotkey;

    expect(resolveShortcuts(overrides)["toggle-play"]).toBe(def);
  });

  // behavior: an override for an unknown action id is ignored, defaults kept (AC-011, E-3)
  it("should ignore an override for an unknown action id and keep all defaults", () => {
    const overrides = {
      bogus: "Mod+Q",
    } as unknown as ShortcutOverrides;

    const effective = resolveShortcuts(overrides);

    expect(effective).not.toHaveProperty("bogus");
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toBe(action.defaultHotkey);
    });
  });

  // behavior: a corrupt overrides map never throws (AC-011, E-2)
  it("should not throw on a corrupt overrides map", () => {
    const overrides = {
      "toggle-play": 42,
      bogus: "Mod+Q",
    } as unknown as ShortcutOverrides;

    expect(() => resolveShortcuts(overrides)).not.toThrow();
  });
});

describe("findConflict", () => {
  // behavior: a hotkey owned by another action returns that owner's id (AC-011, TC-014)
  it("should return the owning action id if another action holds the hotkey", () => {
    const effective = resolveShortcuts({});
    const ownerKey = effective[distinctPair.owner.id];

    const owner = findConflict(ownerKey, distinctPair.other.id, effective);

    expect(owner).toBe(distinctPair.owner.id);
  });

  // behavior: a hotkey owned by no other action returns null (AC-011, TC-014)
  it("should return null if the hotkey is not owned by any other action", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+Shift+Q", distinctPair.other.id, effective);

    expect(owner).toBeNull();
  });

  // behavior: an action's own current binding is not a conflict (AC-011, TC-014, E-6)
  it("should ignore the action being edited when checking for a conflict", () => {
    const effective = resolveShortcuts({});
    const ownKey = effective[distinctPair.owner.id];

    const owner = findConflict(ownKey, distinctPair.owner.id, effective);

    expect(owner).toBeNull();
  });

  // behavior: an unparseable candidate hotkey returns null (AC-011, TC-014, E-4)
  it("should return null if the candidate hotkey is unparseable", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("bogus!!", distinctPair.other.id, effective);

    expect(owner).toBeNull();
  });
});
