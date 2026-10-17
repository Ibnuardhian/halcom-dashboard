import { expect, test } from "@playwright/test";
import { APP_NAME } from "@/config/app";

test("health endpoint reports the app and database as available", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ status: "ok", checks: { database: "ok" } });
});

test("home page renders the product shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(APP_NAME);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(APP_NAME);
  await expect(page.getByRole("link", { name: "Check system health" })).toHaveAttribute(
    "href",
    "/api/health",
  );
});
