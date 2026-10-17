import { expect, test } from "@playwright/test";
import { APP_NAME } from "@/config/app";

test("health endpoint reports the app and database as available", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ status: "ok", checks: { database: "ok" } });
});

test("signed-out visitors land on the login page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle(APP_NAME);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
