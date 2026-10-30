import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the SLA of SOA and Purchasing are two modules in Indonesian, and the superadmin sets where the e-mail goes", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "SUPERADMIN");
  const menu = page.getByRole("navigation").first();
  await expect(menu.getByRole("link", { name: "SLA SOA" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "SLA Purchasing" })).toBeVisible();

  // The old address leads to the first module.
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/admin\/settings\/soa$/);
  await expect(page.getByRole("heading", { level: 1, name: "SLA SOA" })).toBeVisible();
  await expect(page.getByLabel(/^SLA tim SOA/)).toBeVisible();

  await page.goto("/admin/settings/purchasing");
  await expect(page.getByRole("heading", { level: 1, name: "SLA Purchasing" })).toBeVisible();
  await expect(page.getByLabel(/^SLA tim Purchasing/)).toBeVisible();
  await expect(page.getByLabel(/^SLA tim SOA/)).toHaveCount(0);

  const stamp = Date.now();
  const to = `purch-${stamp}@halcominovasi.co.id`;
  const cc = `boss-${stamp}@halcominovasi.co.id`;
  await expect(async () => {
    await page.getByLabel("Kirim ke (To)").fill("bukan alamat");
    await page.getByRole("button", { name: "Simpan pengaturan Purchasing" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Alamat email tidak valid" })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 45_000 });

  await page.getByLabel("Kirim ke (To)").fill(to);
  await page.getByLabel("Tembusan (CC)").fill(`${to}, ${cc}`);
  await page.getByRole("button", { name: "Simpan pengaturan Purchasing" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tersimpan" })).toBeVisible();
  // The boxes keep what was saved; the address already in To is not repeated in CC.
  await expect(page.getByLabel("Kirim ke (To)")).toHaveValue(to);
  await expect(page.getByLabel("Tembusan (CC)")).toHaveValue(cc);
  await page.reload();
  await expect(page.getByLabel("Kirim ke (To)")).toHaveValue(to);

  // The other team keeps its own (empty) recipients, and putting the template back keeps the addresses.
  await page.goto("/admin/settings/soa");
  await expect(page.getByLabel("Kirim ke (To)")).not.toHaveValue(to);
  await page.goto("/admin/settings/purchasing");
  await page.getByLabel("Kirim ke (To)").fill("");
  await page.getByLabel("Tembusan (CC)").fill("");
  await page.getByRole("button", { name: "Simpan pengaturan Purchasing" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tersimpan" })).toBeVisible();
});
