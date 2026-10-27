import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signIn, signInAs, submitLogin } from "./helpers";

async function asRole(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

test("a superadmin changes a user's e-mail, who then signs in with it; an admin has no such button", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const email = `e2e-mail-${stamp}@example.invalid`;
  const next = `e2e-mail-new-${stamp}@example.invalid`;
  const password = "e2e-created-user-pass-1";

  await signIn(page, "SUPERADMIN");
  await page.goto("/admin/users");
  await page.getByLabel("Name", { exact: true }).fill("E2E Mail");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption("Purchasing");
  await page.getByLabel("Initial password").fill(password);
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByRole("status").filter({ hasText: "User created." })).toBeVisible();

  await page.getByRole("button", { name: `Edit ${email}` }).click();
  const form = page.locator("form").filter({ has: page.getByLabel(`Email for ${email}`) });
  await expect(async () => {
    await form.getByLabel(`Email for ${email}`).fill(next);
    await form.getByRole("button", { name: "Change email" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Email diubah." })).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 45_000 });
  await expect(page.getByRole("cell", { name: next, exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: email, exact: true })).toHaveCount(0);
  // The box keeps the saved address.
  await expect(page.getByLabel(`Email for ${next}`)).toHaveValue(next);

  // The new address signs in (the handed-over password still has to be replaced); the old one no longer does.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signInAs(otherPage, next, password);
  await expect(otherPage).toHaveURL(/\/password-change$/);
  await other.close();
  const old = await browser.newContext();
  const oldPage = await old.newPage();
  await submitLogin(oldPage, email, password);
  await expect(oldPage.getByRole("alert")).toBeVisible({ timeout: 10_000 });
  await expect(oldPage).toHaveURL(/\/login/);
  await old.close();

  const admin = await asRole(browser, "ADMIN");
  await admin.goto("/admin/users");
  await expect(admin.getByRole("button", { name: /^Edit / }).first()).toBeVisible();
  await expect(admin.getByRole("button", { name: "Change email" })).toHaveCount(0);
  await admin.context().close();
});

test("the projects can be exported in the import template, and that file imports back as duplicates", async ({ browser }) => {
  test.setTimeout(240_000);
  // The test database may hold no project yet: Sales register one, with a description and a principal, to see them come back.
  const seller = await asRole(browser, "SALES");
  const name = `Export job ${Date.now()}`;
  await seller.goto("/projects/new");
  await expect(async () => {
    await seller.getByLabel("End-user company").fill("E2E Export Co");
    await seller.getByLabel("Project name").fill(name);
    await seller.getByRole("button", { name: "Create project" }).click();
    await expect(seller).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const code = seller.url().split("/").pop()!;
  await seller.context().close();

  const soa = await asRole(browser, "SOA");
  await soa.goto("/projects");
  await expect(async () => {
    await soa.getByRole("button", { name: "Import from Excel" }).click();
    await expect(soa.getByRole("dialog", { name: "Import projects" })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });

  const [download] = await Promise.all([soa.waitForEvent("download"), soa.getByRole("link", { name: "Export projects in this format" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^halcom-projects-import-format-\d{4}-\d{2}-\d{2}\.xlsx$/);
  // The wizard reads the extension, and a download is kept under a bare id: save it under its own name.
  const path = `/tmp/${download.suggestedFilename()}`;
  await download.saveAs(path);
  const sheet = strFromU8(unzipSync(new Uint8Array(readFileSync(path)))["xl/worksheets/sheet1.xml"]!);
  // The template's own header row, then one row per project.
  for (const header of ["End user *", "Project name *", "Project ID", "Sales PIC", "Progress", "Principals", "Next action"]) expect(sheet).toContain(header);
  expect(sheet).toContain(code);
  expect(sheet).toContain(name);
  expect(sheet).toContain("E2E Export Co");

  // Imported back as it is, nothing is new: every row is a duplicate.
  await expect(async () => {
    await soa.getByLabel("Excel workbook (.xlsx)").setInputFiles(path);
    await expect(soa.getByRole("heading", { name: "2. Match the columns" })).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 45_000 });
  await soa.getByRole("button", { name: "Check the sheet" }).click();
  await expect(soa.getByText(/rows in .Projects.: 0 ready, \d+ duplicate/)).toBeVisible({ timeout: 60_000 });
  await soa.context().close();

  // The export dialog on the Overview offers the same file.
  const sales = await asRole(browser, "SALES");
  await sales.goto("/dashboard");
  await sales.getByRole("button", { name: "Export data" }).click();
  const [file] = await Promise.all([sales.waitForEvent("download"), sales.getByRole("button", { name: "Export in import format (.xlsx)" }).click()]);
  expect(file.suggestedFilename()).toContain("import-format");
  await sales.context().close();
});
