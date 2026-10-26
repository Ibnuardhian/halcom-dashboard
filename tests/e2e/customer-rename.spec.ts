import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function createProject(page: Page, company: string) {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill(company);
    await page.getByLabel("Project name").fill("Rename check");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });
}

test("a Superadmin corrects a customer name and merges two spellings of one company; Sales cannot", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = Date.now().toString().slice(-6);
  const typo = `PT Tpyo ${stamp}`;
  const fixed = `PT Typo ${stamp}`;
  const short = `PNP ${stamp}`;
  const full = `Politeknik ${stamp}`;

  await signIn(page, "SALES");
  await createProject(page, typo);
  await createProject(page, short);
  await createProject(page, full);
  // Sales may fill the industry but see no rename or merge.
  await page.goto(`/customers?q=${encodeURIComponent(typo)}`);
  await page.getByRole("button", { name: typo }).click();
  await expect(page.getByLabel("Ubah nama customer")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("customer-dialog")).toBeHidden();
  await signOut(page);

  await signIn(page, "SUPERADMIN");
  // Renaming under the old search term makes the row leave the list, so the result is checked by looking for the new name.
  await expect(async () => {
    await page.goto(`/customers?q=${encodeURIComponent(fixed)}`);
    if ((await page.getByRole("button", { name: fixed }).count()) > 0) return;
    await page.goto(`/customers?q=${encodeURIComponent(typo)}`);
    await page.getByRole("button", { name: typo }).click();
    const dialog = page.getByTestId("customer-dialog");
    await dialog.getByLabel("Ubah nama customer").fill(fixed);
    await dialog.getByRole("button", { name: "Ubah nama" }).click();
    await page.waitForTimeout(2500);
    await page.goto(`/customers?q=${encodeURIComponent(fixed)}`);
    await expect(page.getByRole("button", { name: fixed })).toHaveCount(1, { timeout: 3000 });
  }).toPass({ timeout: 90_000 });
  await page.goto(`/customers?q=${encodeURIComponent(typo)}`);
  await expect(page.getByRole("button", { name: typo })).toHaveCount(0);

  // The short spelling is merged into the full one, after a second confirmation.
  await page.goto(`/customers?q=${encodeURIComponent(short)}`);
  await page.getByRole("button", { name: short }).click();
  const merge = page.getByTestId("customer-dialog");
  await expect(async () => {
    await merge.getByLabel("Gabungkan ke customer lain").selectOption({ label: full });
    await merge.getByRole("button", { name: "Gabungkan…" }).click();
    await expect(merge.getByRole("button", { name: "Ya, gabungkan" })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await merge.getByRole("button", { name: "Ya, gabungkan" }).click();

  await page.goto(`/customers?q=${encodeURIComponent(short)}`);
  await expect(async () => {
    await page.goto(`/customers?q=${encodeURIComponent(short)}`);
    await expect(page.getByRole("button", { name: short })).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.goto(`/customers?q=${encodeURIComponent(full)}`);
  await expect(page.getByRole("row", { name: new RegExp(full) })).toContainText("2");
});
