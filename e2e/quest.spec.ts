import { test, expect, type Page } from "@playwright/test";

// The app boots with SEED_DEMO on, so the first load lands on a populated
// demo quest. These specs run against the production build with iNat stubbed
// by e2e/serve.ts.

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

test("first load shows a populated demo quest with the ranking note", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("California");
  await expect(page.getByText("It's a guide, not a guarantee.")).toBeVisible();
  const cards = page.locator(".target-card:not(.skeleton)");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
});

test("no horizontal scroll at 390px on results and start", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".target-card:not(.skeleton)").first()).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Map what you've never seen" })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("paginates the capped set", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".target-card:not(.skeleton)").first()).toBeVisible();
  await expect(page.getByText(/Page 1 of/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
});

test("builds a fresh quest from the start screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".target-card:not(.skeleton)").first()).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByLabel("iNaturalist username").fill("somenaturalist");
  await page.getByLabel("Place").fill("Cali");
  await page.getByRole("option", { name: /California/ }).click();
  await page.getByLabel("Month").selectOption("5");
  await page.getByRole("button", { name: "Build my quest" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("May");
  await expect(page.locator(".target-card:not(.skeleton)").first()).toBeVisible();
});

test("validates the form before calling the API", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Back" }).click();
  // Returning to Start keeps the last quest pre-filled, so clear the fields
  // to exercise the empty-field validation.
  await page.getByLabel("iNaturalist username").fill("");
  await page.getByLabel("Place").fill("");
  await page.getByLabel("Month").selectOption("");
  await page.getByRole("button", { name: "Build my quest" }).click();
  await expect(page.getByText("Enter a valid iNaturalist username.")).toBeVisible();
  await expect(page.getByText("Pick a place.")).toBeVisible();
  await expect(page.getByText("Pick a month.")).toBeVisible();
});

test("shows the check-the-username message for an unknown user", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByLabel("iNaturalist username").fill("ghostuserzzz");
  await page.getByLabel("Place").fill("Cali");
  await page.getByRole("option", { name: /California/ }).click();
  await page.getByLabel("Month").selectOption("7");
  await page.getByRole("button", { name: "Build my quest" }).click();

  await expect(page.getByText("Check the username and try again.")).toBeVisible();
});

test("start screen inputs are labeled and keyboard reachable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Back" }).click();
  const username = page.getByLabel("iNaturalist username");
  await username.focus();
  await expect(username).toBeFocused();
  await expect(page.getByLabel("Month")).toBeVisible();
});
