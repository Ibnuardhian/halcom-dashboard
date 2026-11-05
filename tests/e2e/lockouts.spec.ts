import { expect, test } from "@playwright/test";
import { signIn, submitLogin } from "./helpers";

test("the sign-in page can show the typed password and hide it again", async ({ page }) => {
  await page.goto("/login");
  const field = page.locator("#password");
  await expect(async () => {
    await field.fill("rahasia-123");
    await page.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(field).toHaveAttribute("type", "text", { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect(field).toHaveValue("rahasia-123");
  await page.getByRole("button", { name: "Sembunyikan sandi" }).click();
  await expect(field).toHaveAttribute("type", "password");
});

test("the superadmin sees who is locked and for how long, and opens the lock", async ({ page, browser }) => {
  // An address that belongs to no account: locking it cannot disturb the seeded users other tests sign in with.
  const email = `nobody-${Date.now()}@example.invalid`;
  const other = await browser.newPage();
  for (let attempt = 0; attempt < 5; attempt += 1) await submitLogin(other, email, "wrong-password");
  await other.close();

  await signIn(page, "SUPERADMIN");
  await page.goto("/admin/lockouts");
  await expect(page.getByRole("heading", { level: 1, name: "Locked accounts" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Bukan akun terdaftar");
  await expect(row).toContainText(/\d+ menit/);

  await expect(async () => {
    await row.getByRole("button", { name: /^Unlock/ }).click();
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0, { timeout: 4000 });
  }).toPass({ timeout: 20_000 });
});

test("only the superadmin can open the page", async ({ page }) => {
  await signIn(page, "ADMIN");
  await page.goto("/admin/lockouts");
  await expect(page.getByRole("heading", { level: 1, name: "Locked accounts" })).toHaveCount(0);
});
