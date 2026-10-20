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
    await page.getByLabel("End-user company").fill("PT Revision Flow");
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/PRJ-\d{3,}$/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });
  return page.url().split("/").pop()!;
}

async function createBoq(page: Page, projectCode: string, title: string): Promise<string> {
  await page.goto(`/projects/${projectCode}`);
  await page.getByRole("link", { name: "New BOQ", exact: true }).click();
  await expect(async () => {
    await page.getByLabel("Summary").fill(title);
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\/projects\/PRJ-\d+\?request=BOQ-[A-Z0-9]+-\d{6,}/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });
  return new URL(page.url()).searchParams.get("request")!;
}

/** Drags a BOQ's card to a column of the BOQ board, the way SOA moves a status. */
async function moveCard(page: Page, code: string, column: string): Promise<void> {
  await page.goto(`/requests/boq?view=board&q=${code}`);
  const card = page.locator(`[data-request="${code}"]`);
  await expect(card).toBeVisible();
  const target = page.locator(`[data-column="${column}"]`);
  await expect(async () => {
    await card.dragTo(target);
    await expect(target.locator(`[data-request="${code}"]`)).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByText(`${code} is now`)).toBeVisible();
}

test("Sales send a completed BOQ back for a revision: it goes straight to Revision and SOA's notification is red", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "SALES");
  const projectCode = await createProject(page, `Revision ${Date.now()}`);
  const code = await createBoq(page, projectCode, "Forty cameras");

  // Nothing to revise yet: the card appears only for a completed BOQ.
  await expect(page.getByRole("heading", { name: "Request a revision" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, "SOA");
  await moveCard(page, code, "COMPLETED");
  await signOut(page);

  await signIn(page, "SALES");
  await page.goto(`/request/${code}`);
  await expect(page.getByRole("heading", { name: "Request a revision" })).toBeVisible();
  await expect(async () => {
    await page.getByLabel("What needs to change?").fill("Add four more cameras at the gate");
    await page.getByRole("button", { name: "Request revision" }).click();
    await expect(page.getByTestId("revision-banner")).toContainText("Add four more cameras at the gate", { timeout: 20_000 });
  }).toPass({ timeout: 120_000 });
  await page.reload();
  await expect(page.getByText("Revision", { exact: true }).first()).toBeVisible();
  // It cannot be asked for twice.
  await expect(page.getByRole("heading", { name: "Request a revision" })).toHaveCount(0);
  await signOut(page);

  // SOA: the BOQ sits in the Revision column, the bell is red and the notification says Revision in words.
  await signIn(page, "SOA");
  const bell = page.getByRole("link", { name: /including a revision request/ });
  await expect(bell).toBeVisible();
  await expect(bell.locator("span")).toHaveClass(/bg-destructive/);
  await page.goto("/notifications");
  const item = page.locator("li", { hasText: `${code}: revision requested` });
  await expect(item).toContainText("Revision");
  await expect(item).toContainText("Add four more cameras at the gate");
  await expect(item.locator("div[data-slot='card']")).toHaveClass(/border-destructive/);
  await page.goto(`/requests/boq?view=board&q=${code}`);
  await expect(page.locator(`[data-column="REVISION"] [data-request="${code}"]`)).toBeVisible();
});

test("Purchasing cannot ask for a revision, and a stranger's BOQ shows no revision card", async ({ page }) => {
  await signIn(page, "PURCHASING");
  await page.goto("/requests/boq");
  // Purchasing may read a BOQ but never gets the card; the service refuses it as well (integration tests).
  await expect(page.getByRole("heading", { name: "Request a revision" })).toHaveCount(0);
});
