import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test("an Admin adds a technical section and an SOA phase, and SOA fills the section on a project and sees the phase on the project", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = Date.now().toString().slice(-6);
  const section = `Pre Assessment ${stamp}`;
  const phase = `Pre Phase ${stamp}`;

  // Sales register a project with a BOQ first.
  await signIn(page, "SALES");
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill(`PT Sections ${stamp}`);
    await page.getByLabel("Project name").fill("Sections");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });
  const projectUrl = page.url();
  await page.goto(`${projectUrl}#requests`);
  await page.getByRole("link", { name: "New BOQ", exact: true }).click();
  await expect(async () => {
    await page.getByLabel("Summary").fill("Phase test");
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\?request=BOQ-/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });
  await signOut(page);

  // The Admin adds a section and a phase.
  await signIn(page, "ADMIN");
  await page.goto("/admin/master-data");
  await page.getByRole("tab", { name: /^Technical sections/ }).click();
  await expect(async () => {
    await page.getByLabel("Nama bagian", { exact: true }).fill(section);
    await page.getByRole("button", { name: "Tambah bagian" }).click();
    await expect(page.getByText("Bagian ditambahkan.")).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByLabel(`Nama bagian ${section}`)).toBeVisible();
  await page.getByRole("tab", { name: /^SOA phases/ }).click();
  await expect(async () => {
    await page.getByLabel("Nama phase", { exact: true }).fill(phase);
    await page.getByRole("button", { name: "Tambah phase" }).click();
    await expect(page.getByText("Phase ditambahkan.")).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 60_000 });
  await signOut(page);

  // SOA fills the section on the project's Technical tab, and finds the phase on the project.
  await signIn(page, "SOA");
  await page.goto(`${projectUrl}#technical`);
  const box = page.getByLabel(section, { exact: true });
  await expect(async () => {
    await box.fill("Form sent to the customer");
    await page.getByRole("button", { name: "Simpan bagian tambahan" }).click();
    await expect(page.getByText("Disimpan dan dicatat di change log.")).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByLabel(section, { exact: true })).toHaveValue("Form sent to the customer");

  await page.goto(`${projectUrl}#technical`);
  await expect(page.getByLabel("Phase").locator("option", { hasText: phase })).toHaveCount(1);
});
