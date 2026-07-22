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
  it("should return a normalized string if the input is a valid hotkey", () => {
    expect(safeNormalize("Mod+J")).toBe("Mod+J");
  });

  it("should canonicalize a lower-case modifier+key into the uppercase form", () => {
    expect(safeNormalize("mod+j")).toBe("Mod+J");
  });

  it("should return null if the input is garbage", () => {
    expect(safeNormalize("not a hotkey!!")).toBeNull();
  });

  it("should return null if the input is an empty string", () => {
    expect(safeNormalize("")).toBeNull();
  });
});

describe("resolveShortcuts (array model)", () => {
  it("should return every action's default as a one-element list if no overrides are given", () => {
    const effective = resolveShortcuts({});

    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toEqual([action.defaultHotkey]);
    });
  });

  it("should return the override for toggle-play and defaults elsewhere", () => {
    const effective = resolveShortcuts({ "toggle-play": ["Mod+P"] });

    expect(effective["toggle-play"]).toEqual(["Mod+P"]);
    SHORTCUT_ACTIONS.filter((a) => a.id !== "toggle-play").forEach((action) => {
      expect(effective[action.id]).toEqual([action.defaultHotkey]);
    });
  });

  it("should resolve a multi-binding override to every normalized hotkey", () => {
    const effective = resolveShortcuts({ "toggle-play": ["Space", "Mod+P"] });

    expect(effective["toggle-play"]).toEqual(["Space", "Mod+P"]);
  });

  it("should resolve an empty-array override to an empty list (disabled)", () => {
    const effective = resolveShortcuts({ "toggle-play": [] });

    expect(effective["toggle-play"]).toEqual([]);
  });

  it("should drop an invalid entry and keep the valid one", () => {
    const effective = resolveShortcuts({ "toggle-play": ["bogus!!", "Mod+P"] });

    expect(effective["toggle-play"]).toEqual(["Mod+P"]);
  });

  it("should fall back to the default list if an override value is not an array", () => {
    const overrides = {
      "toggle-play": "Mod+P",
    } as unknown as ShortcutOverrides;
    const def = SHORTCUT_ACTIONS.find(
      (a) => a.id === "toggle-play",
    )!.defaultHotkey;

    expect(resolveShortcuts(overrides)["toggle-play"]).toEqual([def]);
  });

  it("should ignore an override for an unknown action id and keep all defaults", () => {
    const overrides = {
      bogus: ["Mod+Q"],
    } as unknown as ShortcutOverrides;

    const effective = resolveShortcuts(overrides);

    expect(effective).not.toHaveProperty("bogus");
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toEqual([action.defaultHotkey]);
    });
  });

  it("should not throw on a corrupt overrides map", () => {
    const overrides = {
      "toggle-play": 42,
      bogus: ["Mod+Q"],
    } as unknown as ShortcutOverrides;

    expect(() => resolveShortcuts(overrides)).not.toThrow();
  });
});

describe("findConflict (array model)", () => {
  it("should return the owning action id if another action holds the hotkey", () => {
    const effective = resolveShortcuts({});
    const ownerKey = effective[distinctPair.owner.id][0];

    const owner = findConflict(ownerKey, distinctPair.other.id, effective);

    expect(owner).toBe(distinctPair.owner.id);
  });

  it("should return null if the hotkey is not owned by any other action", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+Shift+Q", distinctPair.other.id, effective);

    expect(owner).toBeNull();
  });

  it("should ignore the action being edited when checking for a conflict", () => {
    const effective = resolveShortcuts({});
    const ownKey = effective[distinctPair.owner.id][0];

    const owner = findConflict(ownKey, distinctPair.owner.id, effective);

    expect(owner).toBeNull();
  });

  it("should return null if the candidate hotkey is unparseable", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("bogus!!", distinctPair.other.id, effective);

    expect(owner).toBeNull();
  });
});
