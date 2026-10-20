import { expect, test, type Page } from "@playwright/test";
import { expectNotFound, signIn } from "./helpers";

async function createProject(page: Page, company: string): Promise<string> {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill(company);
    await page.getByLabel("Project name").fill("Industry check");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/PRJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return page.url().split("/").pop()!;
}

test("Sales fill in a customer's industry in a modal, and the project shows it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "SALES");
  const company = `PT Industri ${Date.now()}`;
  const projectCode = await createProject(page, company);

  await page.goto(`/customers?q=${encodeURIComponent(company)}`);
  const row = page.getByRole("row", { name: new RegExp(company) });
  await expect(row).toContainText("Not set");

  // Clicking the customer's name opens a window for its details.
  await row.getByRole("button", { name: company }).click();
  const dialog = page.getByTestId("customer-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: company })).toBeVisible();

  await expect(async () => {
    await dialog.getByLabel("Industry").fill("  Banking  ");
    await dialog.getByRole("button", { name: "Save industry" }).click();
    await expect(dialog).toBeHidden({ timeout: 6000 });
  }).toPass({ timeout: 45_000 });

  await expect(row).toContainText("Banking");
  await page.goto(`/projects/${projectCode}`);
  await expect(page.getByText("Industry", { exact: true }).locator("xpath=following-sibling::*[1]")).toHaveText("Banking");

  // The industry is suggested the next time, and clearing it works.
  await page.goto(`/customers?q=${encodeURIComponent(company)}`);
  await row.getByRole("button", { name: company }).click();
  await expect(page.locator('datalist option[value="Banking"]')).toHaveCount(1);
  await expect(page.getByTestId("customer-dialog").getByLabel("Industry")).toHaveValue("Banking");
  await page.getByTestId("customer-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("customer-dialog")).toBeHidden();
});

test("the Customers page stays closed to roles without it", async ({ page }) => {
  await signIn(page, "FINANCE");
  await expectNotFound(page, "/customers", "Save industry");
});
