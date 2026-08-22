import { describe, expect, it } from "vitest";
import { demoMedia, demoSettings } from "@/lib/playlist/demo-seed";

describe("demo-seed (AC-009 / TC-009)", () => {
  it("should return a MediaNode[] with distinct ids and valid formats", () => {
    const media = demoMedia();

    expect(media.length).toBeGreaterThan(0);
    const ids = new Set(media.map((node) => node.id));
    expect(ids.size).toBe(media.length);
    for (const node of media) {
      expect(node.name.length).toBeGreaterThan(0);
      expect(node.path.length).toBeGreaterThan(0);
      expect(typeof node.format).toBe("string");
    }
  });

  it("should return a settings object", () => {
    const settings = demoSettings();

    expect(settings.volume).toBe(0.8);
    expect(typeof settings.theme.mode).toBe("string");
  });
});
