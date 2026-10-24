import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill("PT Manual Dates");
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });
  return page.url().split("/").pop()!;
}

async function createBoq(page: Page, projectCode: string, title: string): Promise<string> {
  await page.goto(`/projects/${projectCode}`);
  await page.getByRole("link", { name: "New BOQ", exact: true }).click();
  await expect(async () => {
    await page.getByLabel("Summary").fill(title);
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=BOQ-[A-Z0-9]+-\d{6,}/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });
  return new URL(page.url()).searchParams.get("request")!;
}

test.describe("a superadmin sets the dates of a request by hand", () => {
  test("only the superadmin sees the form, and the saved dates are shown again", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, "SALES");
    const requestCode = await createBoq(page, await createProject(page, `Dates ${Date.now()}`), "BOQ with a late entry");
    await page.goto(`/request/${requestCode}`);
    await expect(page.getByText(/^Status history/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Correct the dates" })).toHaveCount(0);
    await signOut(page);

    await signIn(page, "SUPERADMIN");
    await page.goto(`/request/${requestCode}`);
    await expect(page.getByRole("heading", { name: "Correct the dates" })).toBeVisible();
    // An open request has no completion date to set.
    await expect(page.getByLabel("Completed (UTC)")).toHaveCount(0);
    await expect(async () => {
      await page.getByLabel("Created (UTC) *").fill("2026-09-01T03:30");
      await page.getByRole("button", { name: "Save dates" }).click();
      await expect(page.getByText(`The dates of ${requestCode} were saved.`)).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByLabel("Created (UTC) *")).toHaveValue("2026-09-01T03:30");
  });
});
