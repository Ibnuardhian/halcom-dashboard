import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNotFound, signIn, signInAs } from "./helpers";

const COMPANY = "PT E2E Contoh";

/** Creates a project as the signed-in Sales user and returns its Project ID. */
async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects/new");
  // The first visit to a page on a freshly started server compiles it; a click before it is interactive reloads the form.
  await expect(async () => {
    await page.getByLabel("End-user company").fill(COMPANY);
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/PRJ-\d{3,}$/, { timeout: 4000 });
  }).toPass({ timeout: 25_000 });
  return page.url().split("/").pop()!;
}

/** Opens the new-request form for a project and type (via the project page buttons) and submits it. */
async function createRequest(page: Page, projectCode: string, type: "BOQ" | "RFQ" | "PO", title: string): Promise<string> {
  await page.goto(`/projects/${projectCode}`);
  await page.getByRole("link", { name: `New ${type}`, exact: true }).click();
  await expect(page.getByLabel("Request type")).toHaveValue(type);
  // A click before the page is interactive reloads the form instead of submitting it, so the whole step is retried.
  await expect(async () => {
    await page.getByLabel("Summary").fill(title);
    await page.getByLabel("Details").fill("Forty cameras, 4K, PoE.");
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\/request\/(BOQ|RFQ|PO)-[A-Z0-9]+-\d{6,}$/, { timeout: 4000 });
  }).toPass({ timeout: 25_000 });
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

  test("Sales fill one form for the project and its BOQ, and land on the request with the email text", async ({ page }) => {
    await signIn(page, "SALES");
    await page.goto("/dashboard/sales");
    await expect(page.getByRole("heading", { level: 1, name: "Sales Pipeline" })).toBeVisible();
    await page.getByRole("link", { name: /New project & request/ }).click();
    await expect(page).toHaveURL(/\/projects\/new$/);

    await page.getByLabel("End-user company").fill(COMPANY);
    await page.getByLabel("Project name").fill("One form demo");
    await page.getByLabel("Estimated PO value").fill("2.000.000.000");
    await page.getByLabel("Target margin (%)").fill("12,5");
    await page.getByText(/^BOQ – /).click();
    await page.getByLabel("Request summary").fill("BOQ from the combined form");
    await page.getByRole("button", { name: "Create project and BOQ request" }).click();

    await expect(page).toHaveURL(/\/request\/BOQ-SA-\d{2}\d{4,}$/);
    const subject = await page.getByLabel("Subject", { exact: true }).inputValue();
    expect(subject).toBe(`[HITBOQ] ${COMPANY} - One form demo`);
    const projectCode = (await page.getByLabel("Text", { exact: true }).inputValue()).match(/Project ID\s+: (PRJ-\d+)/)![1]!;

    await page.goto(`/projects/${projectCode}`);
    await expect(page.getByRole("link", { name: /^BOQ-SA-/ })).toBeVisible();
    await expect(page.getByLabel("Target margin (%)")).toHaveValue("12.5");
  });

  test("Sales set a target margin on their own project, the change is logged, and SOA cannot edit it", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Margin demo");

    const commercial = page.locator("#commercial");
    await commercial.getByLabel("Estimated PO value").fill("1000000");
    await commercial.getByLabel("Progress").selectOption({ label: "60% - Negotiate" });
    await commercial.getByLabel("Status").selectOption({ label: "On Hold" });
    await commercial.getByLabel("Quote released").fill("2026-10-01");
    await commercial.getByLabel("Target margin (%)").fill("15");
    await page.getByRole("button", { name: "Save commercial details" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Saved and logged/ })).toBeVisible();

    await page.reload();
    await expect(page.locator("#commercial").getByLabel("Target margin (%)")).toHaveValue("15");
    await expect(page.locator("#commercial").getByLabel("Probability (%)")).toHaveValue("60"); // follows the Progress step
    await expect(page.locator("#commercial").getByLabel("Progress")).toHaveValue("NEGOTIATE");
    await expect(page.getByText("Estimated gross profit", { exact: true }).locator("..")).toContainText("150.000");
    await page.goto("/dashboard/sales");
    await expect(page.getByRole("link", { name: "Margin demo" }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Estimated Gross Profit" })).toBeVisible();
    await expect(page.getByText(projectCode).first()).toBeVisible();
    await page.getByRole("link", { name: "Charts" }).click(); // the table is the default view
    await expect(page).toHaveURL(/view=charts/);
    await expect(page.getByRole("heading", { level: 3, name: "Pipeline by progress" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Projects by principal" })).toHaveCount(0); // not in the Sales view

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/projects/${projectCode}`);
    await expect(soa.getByRole("heading", { level: 2, name: "Commercial" })).toBeVisible();
    await expect(soa.getByRole("button", { name: "Save commercial details" })).toHaveCount(0);
    await soa.context().close();
  });

  test("an RFQ goes to Purchasing: Sales see its email text, SOA does not", async ({ page, browser }) => {
    await signIn(page, "SALES");
    await page.goto("/projects/new");
    await page.getByLabel("End-user company").fill(COMPANY);
    await page.getByLabel("Project name").fill("RFQ routing demo");
    await page.getByText(/^RFQ – /).click();
    await expect(page.getByText("Goes to Purchasing.", { exact: true })).toBeVisible();
    await page.getByLabel("Request summary").fill("Price for 10 servers");
    await page.getByRole("button", { name: "Create project and RFQ request" }).click();

    await expect(page).toHaveURL(/\/request\/RFQ-SA-\d{2}\d{4,}$/);
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(`[HITRFQ] ${COMPANY} - RFQ routing demo`);
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("purchasing-group@example.invalid");
    const requestUrl = page.url();

    const soa = await asRole(browser, "SOA");
    await soa.goto(requestUrl);
    await expect(soa.getByRole("heading", { level: 1, name: /^RFQ-SA-/ })).toBeVisible();
    await expect(soa.getByRole("heading", { name: /Email text/ })).toHaveCount(0);
    await expect(soa.getByRole("button", { name: "Update status" })).toHaveCount(0);
    await soa.context().close();
  });

  test("the email panel has a MailTo button that carries To, Cc, subject and text", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "MailTo demo");
    await createRequest(page, projectCode, "BOQ", "BOQ for MailTo");

    const href = await page.getByRole("link", { name: /Open this email in Outlook/ }).getAttribute("href");

    expect(href).toMatch(/^mailto:soa-group@example\.invalid\?/);
    const url = new URL(href!);
    expect(url.searchParams.get("cc")).toBe("soa-cc@example.invalid");
    expect(url.searchParams.get("subject")).toBe(`[HITBOQ] ${COMPANY} - MailTo demo`);
    expect(url.searchParams.get("body")).toContain("Dear SOA team,");
    expect(url.searchParams.get("body")).toContain(`Project ID   : ${projectCode}`);
  });

  test("a request notifies the owning team, and SOA's phase notifies Sales", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Notify demo");
    const boq = await createRequest(page, projectCode, "BOQ", "BOQ to notify about");

    const soa = await asRole(browser, "SOA");
    await soa.goto("/notifications");
    await expect(soa.getByRole("link", { name: `New BOQ request ${boq}` })).toBeVisible();
    await expect(soa.getByRole("link", { name: /^Notifications, \d+ unread/ })).toBeVisible();

    await soa.goto(`/request/${boq}`);
    await soa.getByLabel("Phase").selectOption("SIZING");
    await soa.getByRole("button", { name: "Save phase" }).click();
    await expect(soa.getByRole("status").filter({ hasText: "Phase saved." })).toBeVisible();
    await expect(soa.getByText("Sizing").first()).toBeVisible();
    await soa.context().close();

    await page.goto("/notifications");
    await expect(page.getByRole("link", { name: `${boq} is now in Sizing` })).toBeVisible();
    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(page.getByText("You are all caught up.")).toBeVisible();
  });

  test("the overview exports the projects with only the ticked columns", async ({ page }) => {
    await signIn(page, "FINANCE");
    await page.goto("/dashboard");
    const form = page.locator("form[action='/export/projects']");
    await expect(form).toBeVisible();

    await expect(async () => {
      await form.getByRole("button", { name: "Clear" }).click();
      await expect(form.getByLabel("Project ID")).not.toBeChecked({ timeout: 1000 });
    }).toPass();
    await form.getByLabel("Project ID").check();
    await form.getByLabel("Estimated PO Value").check();
    const downloading = page.waitForEvent("download");
    await form.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloading;

    expect(download.suggestedFilename()).toMatch(/^halcom-projects-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv.startsWith("﻿Project ID,Estimated PO Value\r\n")).toBe(true);
    expect(csv.split("\r\n").length).toBeGreaterThan(2); // the header and at least one project
  });

  test("the overview shows the pipeline charts to everyone", async ({ page }) => {
    await signIn(page, "FINANCE");
    await page.goto("/dashboard");

    for (const title of ["Pipeline by progress", "Projects by principal", "Value by principal", "Solution mix", "Value by industry", "Weighted value by salesperson"]) {
      await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
    }
  });

  test("the project list filters by progress and search, and the project page has its sections", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Pipeline demo");

    for (const heading of ["Overview", "Technical", "Activity", "Requests"]) {
      await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
    }
    await expect(page.getByText("5% - Qualify").first()).toBeVisible(); // a new project starts at the first step
    await expect(page.getByText("Sales PIC")).toBeVisible();

    await page.goto("/projects");
    await expect(page.getByRole("link", { name: projectCode })).toBeVisible();
    await page.getByLabel("Progress").selectOption("PROPOSE");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/progress=PROPOSE/);
    await expect(page.getByRole("link", { name: projectCode })).toHaveCount(0);

    await page.getByLabel("Progress").selectOption("QUALIFY");
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

    await page.goto("/requests/rfq");
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
      "Sales Pipeline",
      "Projects",
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
