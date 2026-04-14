import { expect, test } from "@playwright/test";

test("selected-card dismiss prunes descendant rows locally", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".generator-row")).toHaveCount(2, { timeout: 15000 });

  const firstCard = page.locator(".generator-row .cinenerdle-card").first();
  await firstCard.click();

  const dismissBubble = page.locator(".generator-row").nth(1)
    .locator(".cinenerdle-card-selected .cinenerdle-card-unselect-bubble");
  await expect(dismissBubble).toBeVisible();
  await dismissBubble.click();

  await expect(page.locator(".generator-row")).toHaveCount(2);
  await expect(page.locator(".bacon-connection-pill")).toContainText("cinenerdle");
});
