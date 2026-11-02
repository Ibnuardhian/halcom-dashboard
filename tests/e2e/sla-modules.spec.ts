import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("SLA, recipients and email template of every team are on one Email & SLA page, and the superadmin sets where the e-mail goes", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "SUPERADMIN");
  const menu = page.getByRole("navigation").first();
  await expect(menu.getByRole("link", { name: "Email & SLA" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "SLA SOA" })).toHaveCount(0);

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Email & SLA" })).toBeVisible();
  const soa = page.locator("#soa");
  const purchasing = page.locator("#purchasing");
  await expect(soa.getByLabel(/^SLA tim SOA/)).toBeVisible();
  await expect(purchasing.getByLabel(/^SLA tim Purchasing/)).toBeVisible();

  // The old per-team addresses lead to their section.
  await page.goto("/admin/settings/purchasing");
  await expect(page).toHaveURL(/\/admin\/settings#purchasing$/);

  const stamp = Date.now();
  const to = `purch-${stamp}@halcominovasi.co.id`;
  const cc = `boss-${stamp}@halcominovasi.co.id`;
  await expect(async () => {
    await purchasing.getByLabel("Kirim ke (To)").fill("bukan alamat");
    await purchasing.getByRole("button", { name: "Simpan pengaturan Purchasing" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Alamat email tidak valid" })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });

  await purchasing.getByLabel("Kirim ke (To)").fill(to);
  await purchasing.getByLabel("Tembusan (CC)").fill(`${to}, ${cc}`);
  await purchasing.getByRole("button", { name: "Simpan pengaturan Purchasing" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tersimpan" })).toBeVisible();
  // The boxes keep what was saved; the address already in To is not repeated in CC.
  await expect(purchasing.getByLabel("Kirim ke (To)")).toHaveValue(to);
  await expect(purchasing.getByLabel("Tembusan (CC)")).toHaveValue(cc);
  await page.reload();
  await expect(purchasing.getByLabel("Kirim ke (To)")).toHaveValue(to);

  // The other team keeps its own (empty) recipients.
  await expect(soa.getByLabel("Kirim ke (To)")).not.toHaveValue(to);
  await purchasing.getByLabel("Kirim ke (To)").fill("");
  await purchasing.getByLabel("Tembusan (CC)").fill("");
  await purchasing.getByRole("button", { name: "Simpan pengaturan Purchasing" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tersimpan" })).toBeVisible();
});
