import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { templateHeaders } from "@/domain/projects/import";
import { toXlsx } from "@/server/export/xlsx";
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
    await soa.getByRole("button", { name: "Export/Import (xlsx)" }).click();
    await expect(soa.getByRole("dialog", { name: "Impor project" })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });

  const [download] = await Promise.all([soa.waitForEvent("download"), soa.getByRole("link", { name: "Export project dalam format ini" }).click()]);
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
    await soa.getByLabel("Workbook Excel (.xlsx)").setInputFiles(path);
    await expect(soa.getByRole("heading", { name: "2. Cocokkan kolom" })).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 45_000 });
  await soa.getByRole("button", { name: "Periksa sheet" }).click();
  await expect(soa.getByText(/baris di .Projects.: 0 siap, \d+ duplikat/)).toBeVisible({ timeout: 60_000 });
  await soa.context().close();

  // The export dialog on the Overview offers the same file.
  const sales = await asRole(browser, "SALES");
  await sales.goto("/dashboard");
  await sales.getByRole("button", { name: "Export data" }).click();
  const [file] = await Promise.all([sales.waitForEvent("download"), sales.getByRole("button", { name: "Export in import format (.xlsx)" }).click()]);
  expect(file.suggestedFilename()).toContain("import-format");
  await sales.context().close();
});

test("an admin updates existing projects from a sheet: end user, Sales PIC and principals, with a confirmation for new names", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const seller = await asRole(browser, "SALES");
  await seller.goto("/projects/new");
  await expect(async () => {
    await seller.getByLabel("End-user company").fill(`Bulk Old ${stamp}`);
    await seller.getByLabel("Project name").fill(`Bulk job ${stamp}`);
    await seller.getByRole("button", { name: "Create project" }).click();
    await expect(seller).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const code = seller.url().split("/").pop()!;
  await seller.context().close();

  // The sheet an admin would have edited: the template's columns, with the project's ID and the cells to change.
  const headers = templateHeaders();
  const values: Record<string, string> = { "End user": `Bulk New ${stamp}`, "Project name": `Bulk job ${stamp}`, "Project ID": code, Principals: `Bulk HPE ${stamp}; Bulk Aruba ${stamp}` };
  const merged = headers.map((header) => values[header.replace(/ \*$/, "")] ?? null);
  const workbook = Buffer.from(toXlsx("Projects", headers, [merged]));

  const admin = await asRole(browser, "ADMIN");
  await admin.goto("/projects");
  await expect(async () => {
    await admin.getByRole("button", { name: "Export/Import (xlsx)" }).click();
    await expect(admin.getByRole("dialog", { name: "Impor project" })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await admin.getByLabel(/^Perbarui project yang sudah ada/).check();
  await expect(async () => {
    await admin.getByLabel("Workbook Excel (.xlsx)").setInputFiles({ name: `bulk-${stamp}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook });
    await expect(admin.getByRole("heading", { name: "2. Cocokkan kolom" })).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 45_000 });
  await admin.getByRole("button", { name: "Periksa sheet" }).click();
  await expect(admin.getByText(/Tidak ada yang ditulis sebelum Anda memperbarui/)).toContainText(/1\s+akan diperbarui,\s+0\s+tidak berubah/, { timeout: 30_000 });
  await expect(admin.getByText(`End user: Bulk Old ${stamp} → Bulk New ${stamp}`)).toBeVisible();
  await expect(admin.getByText(`Principal: – → Bulk HPE ${stamp}; Bulk Aruba ${stamp}`)).toBeVisible();

  // New names are created only after the spelling is confirmed.
  const update = admin.getByRole("button", { name: "Perbarui 1 project" });
  await expect(update).toBeDisabled();
  await admin.getByLabel("Ejaannya benar, buat nama-nama ini").check();
  await update.click();
  await expect(admin.getByRole("heading", { name: "Pembaruan selesai" })).toBeVisible({ timeout: 60_000 });
  await admin.context().close();

  const check = await asRole(browser, "SOA");
  await check.goto(`/projects/${code}`);
  await expect(check.getByText(`Bulk New ${stamp}`).first()).toBeVisible();
  await expect(check.getByText(`Bulk Aruba ${stamp}`).first()).toBeVisible();
  await check.context().close();
});
