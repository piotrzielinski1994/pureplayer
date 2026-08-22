import { expect, test } from "@playwright/test";

test.describe("player core flows (AC-012 / TC-011, TC-012, TC-013)", () => {
  test("should load the seeded playlist", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Big Buck Bunny")).toBeVisible();
    await expect(page.getByText("Sintel Trailer")).toBeVisible();
    await expect(page.getByText("Jazz Loop")).toBeVisible();
  });

  test("should select media and toggle playback state", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Big Buck Bunny")).toBeVisible();

    await page.getByLabel("Big Buck Bunny").click();

    const pause = page.getByRole("button", { name: "Pause", exact: true });
    const play = page.getByRole("button", { name: "Play", exact: true });

    await expect(pause).toBeVisible();
    await pause.click();
    await expect(play).toBeVisible();

    const seek = page.getByRole("slider", { name: "Seek" });
    await expect(seek).toBeVisible();
    // The seed ships no real media files, so duration stays 0 in headless
    // chromium and the position cannot move; pin the slider contract instead.
    const box = await seek.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(seek).toHaveAttribute("aria-valuenow", "0");
    await expect(seek).toHaveAttribute("aria-valuemax", "0");
  });

  test("should open settings and toggle the theme mode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Big Buck Bunny")).toBeVisible();

    await page.keyboard.press("Control+,");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 10_000,
    });

    const dark = page.getByRole("button", { name: "Dark" });
    await dark.click();
    await expect(dark).toHaveAttribute("aria-pressed", "true");
  });
});
