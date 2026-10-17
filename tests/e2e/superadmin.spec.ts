import { expect, test, type Page } from "@playwright/test";
import { expectNotFound, signIn } from "./helpers";

/**
 * Picks a theme and waits for it to take effect. A choice made before React has hydrated the
 * switcher is silently ignored, so the pick is repeated until the page reacts.
 */
async function chooseTheme(page: Page, option: "Light" | "Dark" | "System", expectDark: boolean): Promise<void> {
  await expect(async () => {
    await page.getByLabel("Theme").selectOption(option);
    const html = page.locator("html");
    if (expectDark) await expect(html).toHaveClass(/\bdark\b/, { timeout: 1_000 });
    else await expect(html).not.toHaveClass(/\bdark\b/, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test.describe("superadmin tools", () => {
  test("superadmin sees live application and database measurements on the System page", async ({ page }) => {
    await signIn(page, "SUPERADMIN");

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "System" }).click();

    await expect(page).toHaveURL(/\/admin\/system$/);
    await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
    for (const heading of ["Application", "Database", "Other database connections", "Largest tables"]) {
      await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
    }
    await expect(page.getByText(/PostgreSQL 18\./)).toBeVisible();
    await expect(page.getByRole("cell", { name: "audit_events", exact: true })).toBeVisible();
    await expect(page.getByText("Query round trip")).toBeVisible();
  });

  for (const role of ["ADMIN", "SALES", "FINANCE"] as const) {
    test(`${role} has no System menu and cannot open the page`, async ({ page }) => {
      await signIn(page, role);

      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "System" })).toHaveCount(0);
      await expectNotFound(page, "/admin/system", "Query round trip");
    });
  }
});

test.describe("theme switcher", () => {
  test("superadmin can switch to dark and back, and the choice survives a reload", async ({ page }) => {
    await signIn(page, "SUPERADMIN");
    const html = page.locator("html");
    const theme = page.getByLabel("Theme");

    await expect(html).not.toHaveClass(/\bdark\b/);
    await chooseTheme(page, "Dark", true);

    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(theme).toHaveValue("dark");

    await chooseTheme(page, "Light", false);
    await page.reload();
    await expect(html).not.toHaveClass(/\bdark\b/);
  });

  test("system mode follows the operating system preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signIn(page, "SUPERADMIN");

    await chooseTheme(page, "System", true);

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  });

  for (const role of ["ADMIN", "SALES"] as const) {
    test(`${role} does not get the theme control`, async ({ page }) => {
      await signIn(page, role);

      await expect(page.getByLabel("Theme")).toHaveCount(0);
      await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    });
  }
});
