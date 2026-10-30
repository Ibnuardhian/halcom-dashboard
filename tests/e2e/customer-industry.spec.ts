import { expect, test, type Page } from "@playwright/test";
import { expectNotFound, signIn } from "./helpers";

async function createProject(page: Page, company: string): Promise<string> {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill(company);
    await page.getByLabel("Project name").fill("Industry check");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
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
    await dialog.getByLabel("Industry").selectOption("Manufacturing");
    await dialog.getByRole("button", { name: "Save industry" }).click();
    await expect(dialog).toBeHidden({ timeout: 6000 });
  }).toPass({ timeout: 45_000 });

  await expect(row).toContainText("Manufacturing");
  await page.goto(`/projects/${projectCode}`);
  await expect(page.getByText("Industry", { exact: true }).locator("xpath=following-sibling::*[1]")).toHaveText("Manufacturing");

  // The choice is kept the next time the window opens.
  await page.goto(`/customers?q=${encodeURIComponent(company)}`);
  await row.getByRole("button", { name: company }).click();
  await expect(page.getByTestId("customer-dialog").getByLabel("Industry")).toHaveValue("Manufacturing");
  await page.getByTestId("customer-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("customer-dialog")).toBeHidden();
});

test("the Customers page stays closed to roles without it", async ({ page }) => {
  await signIn(page, "FINANCE");
  await expectNotFound(page, "/customers", "Save industry");
});

test("an admin edits the list of industries, and Sales then find the new one in the customer's window", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const name = `E2E Sector ${stamp}`;
  const renamed = `E2E Sector ${stamp} Renamed`;

  await signIn(page, "ADMIN");
  await page.goto("/admin/master-data");
  await page.getByRole("tab", { name: /^Industri/ }).click();
  await expect(page.getByRole("heading", { name: "Industri customer" })).toBeVisible();
  await expect(async () => {
    await page.getByLabel("Nama industri", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Tambah industri" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Industri ditambahkan." })).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 45_000 });
  await page.getByLabel("Cari Industri").fill(name);
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("Belum dipakai");

  // Sales choose it from the list.
  const other = await browser.newContext();
  const sales = await other.newPage();
  await signIn(sales, "SALES");
  const company = `PT Sektor ${stamp}`;
  await sales.goto("/projects/new");
  await expect(async () => {
    await sales.getByLabel("End-user company").fill(company);
    await sales.getByLabel("Project name").fill("Sector check");
    await sales.getByRole("button", { name: "Create project" }).click();
    await expect(sales).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  await sales.goto(`/customers?q=${encodeURIComponent(company)}`);
  await sales.getByRole("row", { name: new RegExp(company) }).getByRole("button", { name: company }).click();
  const dialog = sales.getByTestId("customer-dialog");
  await expect(async () => {
    await dialog.getByLabel("Industry").selectOption(name);
    await dialog.getByRole("button", { name: "Save industry" }).click();
    await expect(dialog).toBeHidden({ timeout: 6000 });
  }).toPass({ timeout: 45_000 });

  // Renaming (in the Edit window) moves the customer with it; the name cannot be deleted while it is in use.
  await page.reload();
  await page.getByRole("tab", { name: /^Industri/ }).click();
  await page.getByLabel("Cari Industri").fill(name);
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("1 customer");
  await expect(async () => {
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await expect(page.getByRole("dialog", { name: `Edit ${name}` })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const edit = page.locator("dialog[open]");
  await expect(edit.getByRole("button", { name: `Hapus ${name}` })).toBeDisabled();
  await edit.getByLabel("Nama", { exact: true }).fill(renamed);
  await edit.getByRole("button", { name: "Simpan" }).click();
  await expect(edit.getByRole("status").filter({ hasText: "ikut berubah" })).toBeVisible({ timeout: 8000 });
  await sales.goto(`/customers?q=${encodeURIComponent(company)}`);
  await expect(sales.getByRole("row", { name: new RegExp(company) })).toContainText(renamed);
  await other.close();
});
