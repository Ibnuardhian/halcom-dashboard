import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Email and SLA are two pages for every team, and the superadmin sets where the e-mail goes and the SLA", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "SUPERADMIN");
  const menu = page.getByRole("navigation").first();
  await expect(menu.getByRole("link", { name: "Email", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "SLA", exact: true })).toBeVisible();

  // SLA page: only the SLA of each team, no email boxes.
  await page.goto("/admin/settings/sla");
  await expect(page.getByRole("heading", { level: 1, name: "SLA" })).toBeVisible();
  await expect(page.getByLabel(/^SLA tim SOA/)).toBeVisible();
  await expect(page.getByLabel(/^SLA tim Purchasing/)).toBeVisible();
  await expect(page.getByLabel("To", { exact: true })).toHaveCount(0);

  // Email page: recipients and template of each team, no SLA boxes. The old per-team addresses lead to their section.
  await page.goto("/admin/settings/purchasing");
  await expect(page).toHaveURL(/\/admin\/settings\/email#purchasing$/);
  await expect(page.getByRole("heading", { level: 1, name: "Email" })).toBeVisible();
  await expect(page.getByLabel(/^SLA tim/)).toHaveCount(0);
  const soa = page.locator("#soa");
  const purchasing = page.locator("#purchasing");

  const stamp = Date.now();
  const to = `purch-${stamp}@halcominovasi.co.id`;
  const cc = `boss-${stamp}@halcominovasi.co.id`;
  await expect(async () => {
    await purchasing.getByLabel("To", { exact: true }).fill("bukan alamat");
    await purchasing.getByRole("button", { name: "Simpan email Purchasing" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Alamat email tidak valid" })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });

  await purchasing.getByLabel("To", { exact: true }).fill(to);
  await purchasing.getByLabel("Cc", { exact: true }).fill(`${to}, ${cc}`);
  await purchasing.getByRole("button", { name: "Simpan email Purchasing" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tersimpan" })).toBeVisible();
  // The boxes keep what was saved; the address already in To is not repeated in CC.
  await expect(purchasing.getByLabel("To", { exact: true })).toHaveValue(to);
  await expect(purchasing.getByLabel("Cc", { exact: true })).toHaveValue(cc);
  await page.reload();
  await expect(purchasing.getByLabel("To", { exact: true })).toHaveValue(to);
  await expect(soa.getByLabel("To", { exact: true })).not.toHaveValue(to);

  // Saving the SLA leaves the recipients alone.
  await page.goto("/admin/settings/sla");
  const sla = page.getByLabel(/^SLA tim Purchasing/);
  const before = await sla.inputValue();
  await sla.fill("1-4");
  await page.getByRole("button", { name: "Simpan SLA Purchasing" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Tersimpan|Tidak ada perubahan/ })).toBeVisible();
  await sla.fill(before);
  await page.getByRole("button", { name: "Simpan SLA Purchasing" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Tersimpan|Tidak ada perubahan/ })).toBeVisible();
  await page.goto("/admin/settings/email");
  await expect(page.locator("#purchasing").getByLabel("To", { exact: true })).toHaveValue(to);

  await purchasing.getByLabel("To", { exact: true }).fill("");
  await purchasing.getByLabel("Cc", { exact: true }).fill("");
  await purchasing.getByRole("button", { name: "Simpan email Purchasing" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tersimpan" })).toBeVisible();
});
