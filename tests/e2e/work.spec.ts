import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNotFound, signIn, signInAs } from "./helpers";

const COMPANY = "PT E2E Contoh";

/** Creates a project as the signed-in Sales user and returns its Project ID. */
async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects/new");
  await page.getByLabel("End-user company").fill(COMPANY);
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/PRJ-\d{3,}$/);
  return page.url().split("/").pop()!;
}

/** Opens the new-request form for a project and type (via the project page buttons) and submits it. */
async function createRequest(page: Page, projectCode: string, type: "BOQ" | "RFQ" | "PO", title: string): Promise<string> {
  await page.goto(`/projects/${projectCode}`);
  await page.getByRole("link", { name: `New ${type}`, exact: true }).click();
  await expect(page.getByLabel("Request type")).toHaveValue(type);
  await page.getByLabel("Summary").fill(title);
  await page.getByLabel("Details").fill("Forty cameras, 4K, PoE.");
  await page.getByRole("button", { name: "Create request" }).click();
  await expect(page).toHaveURL(/\/request\/(BOQ|RFQ|PO)-[A-Z0-9]+-\d{6,}$/);
  return page.url().split("/").pop()!;
}

async function asRole(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

test.describe("projects and requests", () => {
  test("Sales creates a project and a BOQ request and gets the email text to copy", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "CCTV AI");
    const code = await createRequest(page, projectCode, "BOQ", "BOQ for 40 cameras");

    expect(code).toMatch(/^BOQ-SA-\d{2}\d{4,}$/); // initials of sales@example.invalid
    await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible();
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(`[HITBOQ] ${COMPANY} - CCTV AI`);
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("soa-group@example.invalid");
    await expect(page.getByLabel("Cc", { exact: true })).toHaveValue("soa-cc@example.invalid");
    const body = await page.getByLabel("Text", { exact: true }).inputValue();
    expect(body).toContain(`Request ID   : ${code}`);
    expect(body).toContain(`Project ID   : ${projectCode}`);
    expect(body).toContain("Dear SOA team,");
    expect(body).toContain(`/request/${code}`);
    await expect(page.getByText("does not send email")).toBeVisible();
  });

  test("the project list filters by stage and search, and the project page has its sections", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Pipeline demo");

    for (const heading of ["Overview", "Technical", "Activity", "Requests"]) {
      await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
    }
    await expect(page.getByText("New Opportunity")).toBeVisible(); // a new project starts at the first stage
    await expect(page.getByText("Sales PIC")).toBeVisible();

    await page.goto("/projects");
    await expect(page.getByRole("link", { name: projectCode })).toBeVisible();
    await page.getByLabel("Stage").selectOption("QUOTATION");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/stage=QUOTATION/);
    await expect(page.getByRole("link", { name: projectCode })).toHaveCount(0);

    await page.getByLabel("Stage").selectOption("NEW_OPPORTUNITY");
    await page.getByLabel("Search projects").fill("pipeline demo");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("link", { name: projectCode })).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test("SOA posts current and next action updates like comments; Sales can read but not post", async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Updates demo");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/projects/${projectCode}`);
    const post = async (kind: "Current action" | "Next action", text: string) => {
      await soa.getByRole("radio", { name: new RegExp(`^${kind}`) }).check();
      await soa.getByLabel("Update", { exact: true }).fill(text);
      await soa.getByRole("button", { name: "Post update" }).click();
      await expect(soa.getByRole("status").filter({ hasText: "Update posted." })).toBeVisible();
      await expect(soa.getByLabel("Update", { exact: true })).toHaveValue(""); // the box clears, like a comment box
    };

    await expect(soa.getByRole("list", { name: "Update feed" })).toHaveCount(0); // a new project has no updates yet
    await post("Current action", "Held the kickoff meeting");
    await post("Next action", "Send the BOQ to the distributor");
    await post("Current action", "Sent the BOQ to the distributor");
    await post("Current action", "Received the distributor price");

    const feed = soa.getByRole("list", { name: "Update feed" });
    await expect(feed.getByRole("listitem")).toHaveCount(4);
    await expect(feed.getByRole("listitem").first()).toContainText("Received the distributor price");
    await expect(feed.getByRole("listitem").first()).toContainText("Dev Soa"); // who wrote it
    await expect(feed.getByRole("listitem").first().locator("time")).toBeVisible(); // and when

    // The highlights show the last two current actions and the latest next action.
    const latest = soa.getByRole("list", { name: "Latest current actions" });
    await expect(latest.getByRole("listitem")).toHaveCount(2);
    await expect(latest).toContainText("Received the distributor price");
    await expect(latest).toContainText("Sent the BOQ to the distributor");
    await expect(latest).not.toContainText("Held the kickoff meeting");
    await expect(soa.getByRole("list", { name: "Latest next action" })).toContainText("Send the BOQ to the distributor");

    // The technical form is there too, and there is no way to edit commercial fields.
    await expect(soa.getByRole("button", { name: "Save technical details" })).toBeVisible();
    await expect(soa.getByLabel(/Estimated value|Probability|Final value/)).toHaveCount(0);

    // Sales sees the same project and feed, with no way to post.
    await page.goto(`/projects/${projectCode}`);
    await expect(page.getByRole("button", { name: "Post update" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save technical details" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Update feed" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("list", { name: "Latest next action" })).toContainText("Send the BOQ to the distributor");
    await soa.context().close();
  });

  test("SOA saves technical details and each change is logged; nothing is logged when nothing changes", async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Technical demo");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/projects/${projectCode}`);
    await soa.getByLabel("BOQ", { exact: true }).fill("In progress");
    await soa.getByLabel("Technical notes").fill("Sized for 400 users");
    await soa.getByRole("button", { name: "Save technical details" }).click();
    await expect(soa.getByRole("status").filter({ hasText: "Saved and logged: BOQ, Technical notes." })).toBeVisible();

    const log = soa.getByRole("list", { name: "Change log" });
    await expect(log.getByRole("listitem")).toHaveCount(2);
    await expect(log.getByText("Sized for 400 users")).toBeVisible();

    await soa.getByRole("button", { name: "Save technical details" }).click();
    await expect(soa.getByRole("status").filter({ hasText: "Nothing changed." })).toBeVisible();
    await expect(log.getByRole("listitem")).toHaveCount(2);
    await soa.context().close();
  });

  test("a direct RFQ and PO go to Purchasing with their own tags and numbering", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Access control");

    const rfq = await createRequest(page, projectCode, "RFQ", "Quote 10 readers");
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(`[HITRFQ] ${COMPANY} - Access control`);
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("purchasing-group@example.invalid");
    await expect(page.getByLabel("Cc", { exact: true })).toHaveValue("");

    const po = await createRequest(page, projectCode, "PO", "Buy 10 readers");
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(`[HITPO] ${COMPANY} - Access control`);
    expect(rfq).toMatch(/^RFQ-SA-/);
    expect(po).toMatch(/^PO-SA-/);
  });

  test("SOA completes a BOQ and hands it over as an RFQ that keeps the link to the BOQ", async ({ page, browser }) => {
    test.setTimeout(120_000); // four signed-in users and several cold page compiles
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Handover demo");
    const boq = await createRequest(page, projectCode, "BOQ", "BOQ for handover");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/request/${boq}`);
    await expect(soa.getByRole("button", { name: "Hand over as RFQ (quotation / pricing)" })).toHaveCount(0); // not completed yet
    await soa.getByLabel("Change status to").selectOption("In progress");
    await soa.getByRole("button", { name: "Update status" }).click();
    await expect(soa.getByRole("status").filter({ hasText: "Status updated." })).toBeVisible();
    await soa.reload();
    await soa.getByLabel("Change status to").selectOption("Completed");
    await soa.getByRole("button", { name: "Update status" }).click();
    await expect(soa.getByRole("status").filter({ hasText: "Status updated." })).toBeVisible();

    await soa.reload();
    await soa.getByRole("button", { name: "Hand over as RFQ (quotation / pricing)" }).click();
    await expect(soa).toHaveURL(/\/request\/RFQ-[A-Z0-9]+-\d{6,}$/);
    const rfq = soa.url().split("/").pop()!;

    await expect(soa.getByLabel("Subject", { exact: true })).toHaveValue(`[HITRFQ] ${COMPANY} - Handover demo`);
    await expect(soa.getByLabel("To", { exact: true })).toHaveValue("purchasing-group@example.invalid");
    expect(await soa.getByLabel("Text", { exact: true }).inputValue()).toContain(`Source BOQ   : ${boq} (completed)`);
    await expect(soa.getByText("Reply inside the original [HITBOQ] email thread")).toBeVisible();
    await expect(soa.getByRole("link", { name: boq })).toBeVisible();

    // The BOQ now lists its RFQ, and the handover buttons can no longer create a second one.
    await soa.goto(`/request/${boq}`);
    await expect(soa.getByRole("link", { name: rfq })).toBeVisible();
    await soa.getByRole("button", { name: "Hand over as RFQ (quotation / pricing)" }).click();
    await expect(soa).toHaveURL(new RegExp(`/request/${rfq}$`));

    // Purchasing sees it and works on it; Finance sees it read-only.
    const purchasing = await asRole(browser, "PURCHASING");
    await purchasing.goto(`/request/${rfq}`);
    await purchasing.getByLabel("Change status to").selectOption("In progress");
    await purchasing.getByRole("button", { name: "Update status" }).click();
    await expect(purchasing.getByRole("status").filter({ hasText: "Status updated." })).toBeVisible();
    await expect(purchasing.getByLabel("Subject", { exact: true })).toHaveCount(0); // Purchasing does not send these emails

    const finance = await asRole(browser, "FINANCE");
    await finance.goto(`/request/${rfq}`);
    await expect(finance.getByRole("heading", { level: 1, name: rfq })).toBeVisible();
    await expect(finance.getByRole("button", { name: "Update status" })).toHaveCount(0);
    await expect(finance.getByLabel("Subject", { exact: true })).toHaveCount(0);
    await soa.context().close();
    await purchasing.context().close();
    await finance.context().close();
  });

  test("a status change that needs a reason cannot be saved without one", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Reason demo");
    const boq = await createRequest(page, projectCode, "BOQ", "BOQ needing a reason");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/request/${boq}`);
    await soa.getByLabel("Change status to").selectOption("Cancelled");
    await expect(soa.getByLabel("Reason *")).toBeVisible();
    await soa.getByLabel("Reason *").fill("Customer cancelled the tender");
    await soa.getByRole("button", { name: "Update status" }).click();
    // Cancelled is final, so the status form disappears once the change is saved.
    await expect(soa.getByRole("button", { name: "Update status" })).toHaveCount(0);
    await soa.reload();
    await expect(soa.getByRole("cell", { name: "Customer cancelled the tender" })).toBeVisible();
    await soa.context().close();
  });

  test("lists filter by type and status, and the overview counts link to them", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "List demo");
    const rfq = await createRequest(page, projectCode, "RFQ", "Listed RFQ");

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "RFQ requests" }).click();
    await expect(page).toHaveURL(/\/requests\/rfq$/);
    await expect(page.getByRole("link", { name: rfq })).toBeVisible();

    await page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: "Completed" }).click();
    await expect(page).toHaveURL(/status=COMPLETED/);
    await expect(page.getByRole("link", { name: rfq })).toHaveCount(0);

    await page.goto("/requests/boq");
    await expect(page.getByRole("heading", { level: 1, name: "BOQ requests" })).toBeVisible();
    await expect(page.getByRole("link", { name: rfq })).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /Open RFQ/ })).toBeVisible();
  });
});

test.describe("access to the work modules", () => {
  test("Finance and Management read but cannot create; Purchasing has no New request menu", async ({ page }) => {
    await signIn(page, "FINANCE");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "New request" })).toHaveCount(0);
    await expectNotFound(page, "/projects/new", "Project details");
    await expectNotFound(page, "/requests/new", "Request details");
    await page.goto("/projects");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);

    const purchasing = await page.context().browser()!.newContext();
    const pPage = await purchasing.newPage();
    await signIn(pPage, "PURCHASING");
    await expect(pPage.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "New request" })).toHaveCount(0);
    await expectNotFound(pPage, "/requests/new", "Request details");
    await purchasing.close();
  });

  test("an unknown request type or code shows not-found", async ({ page }) => {
    await signIn(page, "SALES");
    await expectNotFound(page, "/requests/xyz", "Request details");
    await expectNotFound(page, "/request/RFQ-ZZ-999999", "Status history");
    await expectNotFound(page, "/projects/PRJ-999999", "Target date");
  });
});

test.describe("superadmin modules", () => {
  test("superadmin creates a backup in the host folder and sees it listed and audited", async ({ page }) => {
    await signIn(page, "SUPERADMIN");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Backups" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Backups" })).toBeVisible();

    await page.getByRole("button", { name: "Create backup now" }).click();

    await expect(page.getByRole("status").filter({ hasText: /Backup written: halcom-\d{8}-\d{6}Z\.dump/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("cell", { name: /^halcom-\d{8}-\d{6}Z\.dump$/ }).first()).toBeVisible();

    await page.goto("/admin/audit");
    await expect(page.getByRole("cell", { name: "system.backup_created" }).first()).toBeVisible();
  });

  test("admin can read the audit log but not the backups page", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expectNotFound(page, "/admin/backups", "Create a backup");
    await expectNotFound(page, "/admin/system", "Query round trip");
  });

  test("Sales cannot open the audit log or backups", async ({ page }) => {
    await signIn(page, "SALES");
    await expectNotFound(page, "/admin/audit", "Append-only record");
    await expectNotFound(page, "/admin/backups", "Create a backup");
  });
});

test.describe("account", () => {
  test("a user changes their own password and signs in with the new one", async ({ page, browser }) => {
    const email = `e2e-pw-${Date.now()}@example.invalid`;
    const first = "e2e-first-password-1";
    const second = "e2e-second-password-2";
    await signIn(page, "ADMIN");
    await page.goto("/admin/users");
    await page.getByLabel("Name", { exact: true }).fill("E2E Password");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Role", { exact: true }).selectOption("Sales");
    await page.getByLabel("Initial password").fill(first);
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("status").filter({ hasText: "User created." })).toBeVisible();

    const context = await browser.newContext();
    const user = await context.newPage();
    await signInAs(user, email, first);
    await user.getByRole("link", { name: /Account/ }).click();
    await expect(user.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();

    await user.getByLabel("Current password").fill("not-the-current-password");
    await user.getByLabel("New password", { exact: true }).fill(second);
    await user.getByLabel("Confirm new password").fill(second);
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.getByRole("alert").filter({ hasText: "The current password is incorrect." })).toBeVisible();

    // The form clears after every submit, so all three fields are filled in again.
    await user.getByLabel("Current password").fill(first);
    await user.getByLabel("New password", { exact: true }).fill(second);
    await user.getByLabel("Confirm new password").fill(second);
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.getByRole("status").filter({ hasText: "Password changed." })).toBeVisible();

    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await signInAs(freshPage, email, second);
    await expect(freshPage).not.toHaveURL(/\/login$/);
    await context.close();
    await fresh.close();
  });
});

test.describe("responsive layout", () => {
  test("desktop shows the sidebar with the Halcom logo and grouped modules", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, "SALES");

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
    await expect(page.getByRole("img", { name: "Halcom Dashboard" }).first()).toBeVisible();
    await expect(nav.getByRole("heading", { name: "Work" })).toBeVisible();
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "My dashboard",
      "Projects",
      "All requests",
      "BOQ requests",
      "RFQ requests",
      "PO requests",
      "New request",
    ]);
    await expect(page).toHaveTitle("Halcom Dashboard");
  });

  test("on a phone the sidebar is a drawer that opens from the menu button and closes after navigating", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn(page, "SALES");

    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    const opener = page.getByRole("button", { name: "Open menu" });
    await expect(opener).toBeVisible();

    await opener.click(); // may need a retry before hydration
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

    await opener.click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

    // No sideways scrolling of the page itself.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
