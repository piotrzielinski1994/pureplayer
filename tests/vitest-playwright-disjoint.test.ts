import { describe, expect, it } from "vitest";
import config from "../playwright.config";

describe("vitest/playwright disjointness (AC-013 / TC-014)", () => {
  it("should keep the vitest include and playwright testMatch patterns disjoint", () => {
    const vitestInclude = [
      "src/**/*.test.{ts,tsx}",
      "tests/**/*.spec.{ts,tsx}",
    ];
    const playwrightMatch = String(config.testMatch);

    expect(playwrightMatch).toContain("\\.e2e\\.ts");
    expect(vitestInclude.some((pattern) => pattern.includes("e2e"))).toBe(
      false,
    );
  });

  it("should not pick up tests/e2e/bootstrap.spec.tsx (a Vitest spec)", () => {
    const testMatch = config.testMatch as RegExp;

    expect(config.testDir).toBe("tests/e2e");
    expect(testMatch.test("tests/e2e/bootstrap.spec.tsx")).toBe(false);
  });
});
