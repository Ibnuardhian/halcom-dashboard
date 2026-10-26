import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the End-user company box offers existing customers only after typing has paused for a second", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "SALES");
  const company = `PT Saran ${Date.now()}`;
  // Make sure one customer exists to be suggested: register a project for it first.
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill(company);
    await page.getByLabel("Project name").fill("First one");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });

  await page.goto("/projects/new");
  const box = page.getByLabel("End-user company");
  const list = page.getByRole("listbox", { name: "Customer yang sudah ada" });
  await expect(async () => {
    await box.fill("");
    await box.pressSequentially(company.slice(0, 12), { delay: 30 });
    // Right after typing nothing is offered yet; the list comes once a second has passed.
    await expect(list).toBeHidden({ timeout: 300 });
    await expect(list).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });

  await list.getByRole("button", { name: company }).click();
  await expect(box).toHaveValue(company);
  await expect(list).toBeHidden();
});
