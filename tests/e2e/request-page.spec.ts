import { expect, test, type Page } from "@playwright/test";
import { expectNotFound, signIn } from "./helpers";

async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill("PT One Page");
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });
  return page.url().split("/").pop()!;
}

async function createRequest(page: Page, projectCode: string, type: "BOQ" | "RFQ", title: string): Promise<string> {
  await page.goto(`/projects/${projectCode}#requests`);
  await page.getByRole("link", { name: `New ${type}`, exact: true }).click();
  await expect(async () => {
    await page.getByLabel("Summary").fill(title);
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=(BOQ|RFQ)-[A-Z0-9]+-\d{6,}/, { timeout: 45_000 });
  }).toPass({ timeout: 120_000 });
  return new URL(page.url()).searchParams.get("request")!;
}

test("a request is worked on its project's page: the old address leads there with that request open", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "SALES");
  const projectCode = await createProject(page, `One page ${Date.now()}`);
  const boq = await createRequest(page, projectCode, "BOQ", "First: the BOQ");
  const rfq = await createRequest(page, projectCode, "RFQ", "Second: the RFQ");

  // Creating a request lands on the project page with the new request open (and highlighted by the address).
  expect(page.url()).toContain(`/projects/${projectCode}?request=${rfq}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One page");

  // The permanent address of a request (notifications and emails use it) leads to the same page, with that request open.
  await page.goto(`/request/${boq}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${projectCode}\\?request=${boq}`));
  const open = (code: string) => page.locator(`li#request-${code} > details`);
  await expect(open(boq)).toHaveAttribute("open", "");
  await expect(open(rfq)).not.toHaveAttribute("open", "");
  await expect(page.locator(`li#request-${boq}`).getByText("Status history")).toBeVisible();

  await page.goto(`/request/${rfq}`);
  await expect(open(rfq)).toHaveAttribute("open", "");
  await expect(open(boq)).not.toHaveAttribute("open", "");

  // An unknown request is still not found, and nothing of a request page is shown.
  await expectNotFound(page, "/request/RFQ-ZZ-999999", "Status history");
});
