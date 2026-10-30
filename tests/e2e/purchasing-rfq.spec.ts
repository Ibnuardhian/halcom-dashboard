import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Creates a project as the signed-in Sales user and returns its Project ID. */
async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill("PT Purchasing RFQ");
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return page.url().split("/").pop()!;
}

test("Purchasing raises an RFQ for a project by its Sales PIC, and the Sales PIC sees it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "SALES");
  const projectCode = await createProject(page, `Cabling ${Date.now()}`);
  await signOut(page);

  await signIn(page, "PURCHASING");
  await page.goto("/requests/rfq");
  await page.getByRole("link", { name: "New RFQ request" }).click();
  await expect(page).toHaveURL(/\/requests\/new/);

  // Only an RFQ is offered, and the two PICs narrow the project list.
  const type = page.getByLabel("Request type");
  await expect(type).toHaveValue("RFQ");
  await expect(type.locator("option")).toHaveCount(1);
  const projectOption = page.locator("#request-project option", { hasText: projectCode });
  await expect(projectOption).toHaveCount(1);

  await page.getByLabel("Sales PIC").selectOption({ label: "No Sales PIC (project from another source)" });
  await expect(projectOption).toHaveCount(0);
  await page.getByLabel("Sales PIC").selectOption({ label: "Satrio" });
  await expect(projectOption).toHaveCount(1);

  await page.getByLabel("Project *").selectOption((await projectOption.getAttribute("value"))!);
  const pics = page.getByTestId("request-project-pics");
  await expect(pics).toContainText("Sales PIC: Satrio");
  await expect(pics).toContainText("SOA PIC: None yet");

  // A click before the page is interactive reloads the form instead of submitting it, so the step is retried.
  await expect(async () => {
    await page.getByLabel("Summary").fill("Quote forty PoE switches");
    await page.getByLabel("Details").fill("48-port, managed.");
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=RFQ-[A-Z0-9]+-\d{6,}/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const code = new URL(page.url()).searchParams.get("request")!;
  await expect(page.getByText("Quote forty PoE switches").first()).toBeVisible();
  await signOut(page);

  // The Sales PIC was told, and the RFQ is in their Request Center (requests are counted by the project's owner).
  await signIn(page, "SALES");
  await page.goto("/notifications");
  await expect(page.getByText(`New RFQ request ${code}`)).toBeVisible();
  await page.goto(`/requests?q=${code}`);
  await expect(page.getByRole("link", { name: code })).toBeVisible();
});

test("Purchasing cannot raise a BOQ or a PO, or a project", async ({ page }) => {
  await signIn(page, "PURCHASING");
  await page.goto("/requests/new");
  await expect(page.getByLabel("Request type").locator("option")).toHaveText(["RFQ: RFQ request"]);
  await page.goto("/projects/new");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});
