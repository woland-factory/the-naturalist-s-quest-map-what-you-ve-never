import { test, expect, type Page } from "@playwright/test";

// The app boots with SEED_DEMO on, so a fresh visitor with no stored username
// lands on My quests showing a persisted demo quest. These specs run against
// the production build with iNaturalist stubbed by e2e/serve.ts (species and
// place details canned; taxon map tiles return 404 so the graceful map
// fallback is exercised end to end).

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

async function setStoredLogin(page: Page, login: string) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("nqm.login", value);
  }, login);
}

test("the demo quest is saved and shows on My quests", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your quests" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "California" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open" }).first()).toBeVisible();
});

test("opening the demo quest shows the map, a ranked list, and a self-checked-off Found target", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open" }).first().click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("California");
  await expect(page.getByText("It's a guide, not a guarantee.")).toBeVisible();
  await expect(page.locator(".quest-map")).toBeVisible();
  const cards = page.locator(".target-card:not(.skeleton)");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);

  // The signature moment: a target has crossed itself off from the user's own
  // photo, with provenance, and progress reads on the header. Shown on the
  // seeded demo within the first view, no user input.
  await expect(page.getByRole("heading", { name: "Found" })).toBeVisible();
  await expect(page.getByText(/Confirmed by your photo on /).first()).toBeVisible();
  const foundLink = page.locator(".found-link").first();
  await expect(foundLink).toHaveAttribute("href", /inaturalist\.org\/observations\/\d+/);
  await expect(page.getByText(/\d+ found · \d+ to go/)).toBeVisible();
});

test("top targets on the demo quest carry the seasonality indicator, lower ranks do not", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(page.locator(".target-card:not(.skeleton)").first()).toBeVisible();

  // Pre-warmed from fixtures, so the indicator arrives without a live iNat
  // call: 53 bars, the current-week highlight, and the Peak caption.
  const firstIndicator = page.locator(".target-card .seasonality").first();
  await expect(firstIndicator).toBeVisible();
  await expect(firstIndicator.locator(".season-bar")).toHaveCount(53);
  await expect(firstIndicator.getByText(/^Peak [A-Z][a-z]+$/)).toBeVisible();
  await expect(firstIndicator).toHaveAttribute("aria-label", /Seen most often in [A-Z][a-z]+ here\./);

  // Ranks beyond the top-N carry no indicator (page 2 is ranks 21+).
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".target-card:not(.skeleton)").first()).toBeVisible();
  await expect(page.locator(".target-card .seasonality")).toHaveCount(0);
});

test("the quest screen offers CSV and GeoJSON downloads of the quest", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(page.locator(".target-card:not(.skeleton)").first()).toBeVisible();

  const csvLink = page.getByRole("link", { name: "Export CSV" });
  const geoLink = page.getByRole("link", { name: "Export GeoJSON" });
  await expect(csvLink).toBeVisible();
  await expect(geoLink).toBeVisible();
  await expect(csvLink).toHaveAttribute("href", /\/api\/quests\/[0-9a-f-]{36}\/export\.csv$/);
  await expect(geoLink).toHaveAttribute("href", /\/api\/quests\/[0-9a-f-]{36}\/export\.geojson$/);
  await expect(csvLink).toHaveAttribute("download", "");
  await expect(geoLink).toHaveAttribute("download", "");

  // The endpoints really serve the files the links point to.
  const csvHref = (await csvLink.getAttribute("href"))!;
  const csvRes = await page.request.get(csvHref);
  expect(csvRes.status()).toBe(200);
  expect(csvRes.headers()["content-type"]).toContain("text/csv");
  expect(csvRes.headers()["content-disposition"]).toContain("attachment");
  const csvBody = await csvRes.text();
  expect(csvBody).toContain("status,common_name,scientific_name,taxon_id");
  expect(csvBody).toContain("found,");
  const geoRes = await page.request.get((await geoLink.getAttribute("href"))!);
  expect(geoRes.status()).toBe(200);
  expect(geoRes.headers()["content-type"]).toContain("application/geo+json");
  const geo = (await geoRes.json()) as { type: string; features: unknown[] };
  expect(geo.type).toBe("FeatureCollection");
  expect(geo.features.length).toBeGreaterThan(0);
});

test("failed map tiles show the fallback and the list stays usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open" }).first().click();

  await expect(page.locator(".map-fallback")).toBeVisible();
  await expect(page.getByText("The map didn't load. Your targets are listed below.")).toBeVisible();
  // Selecting another species still works with the list.
  const secondRow = page.locator(".target-card.selectable").nth(1);
  await secondRow.click();
  await expect(page.getByRole("heading", { name: /Where to find/ })).toBeVisible();
});

test("a stored username with no quests lands on Start", async ({ page }) => {
  await setStoredLogin(page, "emptyvisitor");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Map what you've never seen" })).toBeVisible();
});

async function clearQuests(page: Page, login: string) {
  const res = await page.request.get(`/api/quests?login=${login}`);
  const body = (await res.json()) as { quests: { id: string }[] };
  for (const q of body.quests) {
    await page.request.delete(`/api/quests/${q.id}?login=${login}`);
  }
}

test("create a quest, it appears on My quests, and removing it returns the empty state", async ({ page }) => {
  // Guarantee a clean slate for this login so a retry never inherits a quest.
  await clearQuests(page, "e2eowner");
  await setStoredLogin(page, "e2eowner");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Map what you've never seen" })).toBeVisible();

  await page.getByLabel("iNaturalist username").fill("e2eowner");
  await page.getByLabel("Place").fill("Cali");
  await page.getByRole("option", { name: /California/ }).click();
  await page.getByRole("button", { name: "Start quest" }).click();

  await expect(page.locator(".quest-map")).toBeVisible();
  await expect(page.locator(".target-card:not(.skeleton)").first()).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Your quests" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /California/ })).toBeVisible();

  await page.getByRole("button", { name: /^Remove the/ }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start your first quest" })).toBeVisible();
});

test("no horizontal scroll at 390px on My quests and the quest screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your quests" })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(page.locator(".quest-map")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("validates the form before creating a quest", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a quest" }).click();
  await page.getByLabel("iNaturalist username").fill("");
  await page.getByLabel("Place").fill("");
  await page.getByRole("button", { name: "Start quest" }).click();
  await expect(page.getByText("Enter a valid iNaturalist username.")).toBeVisible();
  await expect(page.getByText("Pick a place.", { exact: true })).toBeVisible();
});

test("shows the check-the-username message for an unknown user", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start a quest" }).click();
  await page.getByLabel("iNaturalist username").fill("ghostuserzzz");
  await page.getByLabel("Place").fill("Cali");
  await page.getByRole("option", { name: /California/ }).click();
  await page.getByRole("button", { name: "Start quest" }).click();
  await expect(page.getByText("Check the username and try again.")).toBeVisible();
});
