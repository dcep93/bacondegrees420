import { expect, test } from "@playwright/test";

for (const path of ["/", "/#film|Startup+Movie+(2001)"]) {
  test(`typing during startup survives the initial tree becoming ready: ${path}`, async ({ page }) => {
    let releaseTree!: () => void;
    const treeGate = new Promise<void>((resolve) => { releaseTree = resolve; });

    await page.addInitScript(() => {
      localStorage.setItem("cinenerdle2.tmdbApiKey", "key:playwright-test-key");
    });
    await page.route("https://www.cinenerdle.app/**", async (route) => {
      if (new URL(route.request().url()).pathname.includes("daily-starters")) {
        await treeGate;
        await route.fulfill({ json: { data: [] } });
      } else {
        await route.fulfill({ status: 204 });
      }
    });
    await page.route("https://api.themoviedb.org/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/3/search/movie") {
        await treeGate;
      }
      const movie = { id: 9001, title: "Startup Movie", release_date: "2001-01-01" };
      await route.fulfill({ json: { ...movie, results: [movie], cast: [], crew: [] } });
    });
    await page.route("**/dump.json", (route) => route.fulfill({
      json: { format: "cinenerdle-indexed-db-snapshot", version: 13, people: [], films: [] },
    }));

    try {
      await page.goto(path);
      const input = page.locator(".bacon-connection-input");
      await expect(input).toBeEnabled();
      await input.fill("Keanu Reeves");
      await expect(input).toHaveValue("Keanu Reeves");

      releaseTree();
      await expect(page.locator(".cinenerdle-initial-tree-shell-visible")).toBeVisible();
      await expect(page.locator(".generator-row").first()).toBeVisible();
      await expect(input).toHaveValue("Keanu Reeves");
      await expect(input).toBeFocused();

      // Navigation still clears the draft, even without a click outside the input.
      await page.evaluate(() => {
        window.location.hash = window.location.hash ? "" : "#film|Startup+Movie+(2001)";
      });
      await expect(input).toHaveValue("");
    } finally {
      releaseTree();
    }
  });
}
