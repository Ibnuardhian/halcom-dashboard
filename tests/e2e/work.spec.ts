import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNotFound, signIn, signInAs } from "./helpers";

const COMPANY = "PT E2E Contoh";

/** The email subject: [HITBOQ] Company - Project [Request ID]. The Request ID is in it so that a reply carries it. */
function subjectPattern(type: "BOQ" | "RFQ" | "PO", project: string): RegExp {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\[HIT${type}\\] ${escape(COMPANY)} - ${escape(project)} \\[${type}-[A-Z0-9]+-\\d+\\]$`);
}

/** Creates a project as the signed-in Sales user and returns its Project ID. */
async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects/new");
  // The first visit to a page on a freshly started server compiles it; a click before it is interactive reloads the form.
  await expect(async () => {
    await page.getByLabel("End-user company").fill(COMPANY);
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/PRJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
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
    await expect(page).toHaveURL(/\/request\/(BOQ|RFQ|PO)-[A-Z0-9]+-\d{6,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return page.url().split("/").pop()!;
}

/**
 * Drags a request's card to a column of its board: the only place SOA and Purchasing change a status. The page is searched for the
 * request code so its card is on the board whatever else is there. A cancellation (or reopening) asks for a reason first.
 */
async function moveCard(page: Page, type: "BOQ" | "RFQ" | "PO", code: string, column: string, reason?: string): Promise<void> {
  await page.goto(`/requests/${type.toLowerCase()}?view=board&q=${code}`);
  const card = page.locator(`[data-request="${code}"]`);
  await expect(card).toBeVisible();
  const target = page.locator(`[data-column="${column}"]`);
  // A drag before the page is interactive does nothing, so the whole step is retried.
  await expect(async () => {
    await card.dragTo(target);
    if (reason !== undefined) {
      await page.getByRole("dialog").getByLabel("Reason").fill(reason, { timeout: 3000 });
      await page.getByRole("dialog").getByRole("button", { name: /^(Cancel request|Reopen request)$/ }).click({ timeout: 3000 });
    }
    await expect(target.locator(`[data-request="${code}"]`)).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 45_000 });
  // The card moves at once; the board says so when the server has saved it. Only then is it safe to reload.
  await expect(page.getByRole("status").filter({ hasText: `${code} is now` })).toBeVisible({ timeout: 15_000 });
  // It stays there after a reload: the move was saved, not only shown.
  await page.reload();
  await expect(page.locator(`[data-column="${column}"] [data-request="${code}"]`)).toBeVisible();
}

async function asRole(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

test.describe("projects and requests", () => {
  test("Sales creates a project and a BOQ request and gets the email text to copy", async ({ page }) => {
    test.setTimeout(90_000); // the first test on a freshly started server also compiles every page it visits
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "CCTV AI");
    const code = await createRequest(page, projectCode, "BOQ", "BOQ for 40 cameras");

    expect(code).toMatch(/^BOQ-SA-\d{2}\d{4,}$/); // initials of sales@example.invalid
    await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible();
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(subjectPattern("BOQ", "CCTV AI"));
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("soa-group@example.invalid");
    await expect(page.getByLabel("Cc", { exact: true })).toHaveValue("soa-cc@example.invalid");
    const body = await page.getByLabel("Text", { exact: true }).inputValue();
    expect(body).toContain(`Request ID   : ${code}`);
    expect(body).toContain(`Project ID   : ${projectCode}`);
    expect(body).toContain("Dear SOA team,");
    expect(body).toMatch(/Reply by     : \d+ \w+ \d{4} \(SLA [\d-]+ working days\)/);
    expect(body).toContain(`keep the Request ID ${code} in the subject`);
    await expect(page.getByText(/^SLA \([\d-]+ working days\)$/)).toBeVisible();
    expect(body).toContain(`/request/${code}`);
    await page.getByRole("button", { name: /Send email/ }).click(); // the email text is in a modal
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
    await expect(page.getByLabel("Target margin (amount)")).toBeVisible(); // an amount is the default
    await page.getByRole("radio", { name: "Percent" }).check();
    await page.getByLabel("Target margin (%)").fill("12,5");
    await page.getByText(/^BOQ – /).click();
    await page.getByLabel("Request summary").fill("BOQ from the combined form");
    await page.getByRole("button", { name: "Create project and BOQ request" }).click();

    await expect(page).toHaveURL(/\/request\/BOQ-SA-\d{2}\d{4,}$/);
    const subject = await page.getByLabel("Subject", { exact: true }).inputValue();
    expect(subject).toMatch(subjectPattern("BOQ", "One form demo"));
    const projectCode = (await page.getByLabel("Text", { exact: true }).inputValue()).match(/Project ID\s+: (PRJ-\d+)/)![1]!;

    await page.goto(`/projects/${projectCode}`);
    await expect(page.getByRole("list", { name: "Flow of this project" }).getByRole("link", { name: /^BOQ-SA-/ })).toBeVisible();
    await expect(page.getByLabel("Target margin (%)")).toHaveValue("12.5");
  });

  test("a date can be cleared with a button that shows only while it has a value", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "SALES");
    await page.goto("/projects/new");
    const target = page.getByLabel("Target closing", { exact: true });
    await expect(page.getByRole("button", { name: "Clear Target closing" })).toHaveCount(0);
    await expect(async () => {
      // A fill before hydration leaves the typed value in the box; emptying it first makes the next fill a real change.
      await target.fill("");
      await target.fill("2026-12-31");
      await expect(page.getByRole("button", { name: "Clear Target closing" })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await page.getByRole("button", { name: "Clear Target closing" }).click();
    await expect(target).toHaveValue("");
    await expect(page.getByRole("button", { name: "Clear Target closing" })).toHaveCount(0);

    // The request's own date has the same button.
    await page.getByText(/^BOQ – /).click();
    const needed = page.getByLabel("Needed by", { exact: true });
    await needed.fill("2026-11-30");
    await page.getByRole("button", { name: "Clear Needed by" }).click();
    await expect(needed).toHaveValue("");
  });

  test("Propose (30%) means the quotation was submitted: its date is filled in, stays editable, and can be cleared", async ({ page }) => {
    test.setTimeout(150_000);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Propose demo");
    const commercial = page.locator("#commercial");
    const quote = commercial.getByLabel("Quote released", { exact: true });
    const save = async () => {
      await expect(async () => {
        await commercial.getByRole("button", { name: "Save commercial details" }).click();
        await expect(page.getByRole("status").filter({ hasText: /Saved and logged|Nothing changed/ })).toBeVisible({ timeout: 4000 });
      }).toPass({ timeout: 30_000 });
    };

    // The step is named for what it means, and a project with no quotation yet has no date and no clear button.
    await expect(commercial.getByLabel("Progress").locator("option", { hasText: "30% - Propose (Submit Quotation)" })).toHaveCount(1);
    await expect(quote).toHaveValue("");
    await expect(commercial.getByRole("button", { name: "Clear Quote released" })).toHaveCount(0);

    // Moving to Propose fills today's date, which Sales can see and keep.
    await commercial.getByLabel("Progress").selectOption({ label: "30% - Propose (Submit Quotation)" });
    await save();
    await page.goto(`/projects/${projectCode}`);
    await expect(quote).toHaveValue(today);

    // The date stays editable at Propose: moved when the schedule moves...
    await quote.fill("2026-12-15");
    await save();
    await page.goto(`/projects/${projectCode}`);
    await expect(quote).toHaveValue("2026-12-15");

    // ...and cleared with the button, which disappears with the value.
    await commercial.getByRole("button", { name: "Clear Quote released" }).click();
    await expect(quote).toHaveValue("");
    await expect(commercial.getByRole("button", { name: "Clear Quote released" })).toHaveCount(0);
    await save();
    await page.goto(`/projects/${projectCode}`);
    await expect(quote).toHaveValue("");
    await expect(page.getByRole("list", { name: "Change log" })).toContainText("Quote released");
  });

  test("Sales set a target margin on their own project, the change is logged, and SOA cannot edit it", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Margin demo");

    const commercial = page.locator("#commercial");
    await commercial.getByLabel("Estimated PO value").fill("1000000");
    await commercial.getByLabel("Progress").selectOption({ label: "60% - Negotiate" });
    await commercial.getByLabel("Status").selectOption({ label: "On Hold" });
    await commercial.getByLabel("Quote released").fill("2026-10-01");
    await expect(commercial.getByLabel(/Probability/)).toHaveCount(0); // the probability comes from Progress
    await commercial.getByLabel("Target margin (amount)").fill("150000");
    await page.getByRole("button", { name: "Save commercial details" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Saved and logged/ })).toBeVisible();

    await page.reload();
    await expect(page.locator("#commercial").getByLabel("Target margin (amount)")).toHaveValue("150.000");
    await expect(page.locator("#commercial").getByLabel("Progress")).toHaveValue("NEGOTIATE");
    await expect(page.getByText("Estimated gross profit", { exact: true }).locator("..")).toContainText("150.000");
    await page.goto("/dashboard/sales");
    await expect(page.getByRole("link", { name: "Margin demo" }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Estimated Gross Profit" })).toBeVisible();
    await expect(page.getByText(projectCode).first()).toBeVisible();
    await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Charts" }).click(); // the table is the default view
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
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(subjectPattern("RFQ", "RFQ routing demo"));
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("purchasing-group@example.invalid");
    const requestUrl = page.url();

    const soa = await asRole(browser, "SOA");
    await soa.goto(requestUrl);
    await expect(soa.getByRole("heading", { level: 1, name: /^RFQ-SA-/ })).toBeVisible();
    await expect(soa.getByRole("heading", { name: /Email text/ })).toHaveCount(0);
    await expect(soa.getByText(/dragging this request/)).toHaveCount(0); // SOA do not work on an RFQ: no board hint
    await soa.context().close();
  });

  test("the email panel has a MailTo button that carries To, Cc, subject and text", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "MailTo demo");
    await createRequest(page, projectCode, "BOQ", "BOQ for MailTo");

    await page.getByRole("button", { name: /Send email/ }).click(); // the email text is in a modal
    const href = await page.getByRole("link", { name: /Open this email in Outlook/ }).getAttribute("href");

    expect(href).toMatch(/^mailto:soa-group@example\.invalid\?/);
    const url = new URL(href!);
    expect(url.searchParams.get("cc")).toBe("soa-cc@example.invalid");
    expect(url.searchParams.get("subject")).toMatch(subjectPattern("BOQ", "MailTo demo"));
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

  test("Sales enter quarterly targets and see how far they have come", async ({ page }) => {
    // The year is part of the data and the test database lives across runs, so each run uses its own year.
    const year = 2040 + Math.floor(Math.random() * 50);
    await signIn(page, "SALES");

    // A project closed as won in Q1 of that year: 400 final value at a 10% margin.
    await createProject(page, "Target demo");
    const commercial = page.locator("#commercial");
    await commercial.getByLabel("Progress").selectOption({ label: "100% - Closed Won" });
    await commercial.getByLabel("Final PO value").fill("400");
    await commercial.getByRole("radio", { name: "Percent" }).check();
    await commercial.getByLabel("Target margin (%)").fill("10");
    await commercial.getByLabel("Won date").fill(`${year}-02-10`);
    await page.getByRole("button", { name: "Save commercial details" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Saved and logged/ })).toBeVisible();

    await page.goto(`/targets?year=${year}`);
    await expect(page.getByRole("heading", { level: 2, name: `My ${year} targets` })).toBeVisible();
    await expect(async () => {
      // The boxes reset when the page becomes interactive, so they are filled again on every try.
      await page.getByLabel("Q1 revenue target").fill("1.000");
      await page.getByLabel("Q1 gross profit target").fill("100");
      await page.getByLabel("Q2 revenue target").fill("2000");
      await page.getByRole("button", { name: `Save my ${year} targets` }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved targets for Q1, Q2." })).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 20_000 });

    const card = (name: string) => page.getByRole("heading", { level: 2, name, exact: true }).locator("xpath=ancestor::*[@data-slot='card'][1]");
    const revenue = card("Revenue");
    await expect(revenue.getByRole("row", { name: /Q1/ })).toContainText("1.000");
    await expect(revenue.getByRole("row", { name: /Q1/ })).toContainText("400");
    await expect(revenue.getByRole("row", { name: /Q1/ })).toContainText("40%");
    await expect(revenue.getByRole("row", { name: /Q2/ })).toContainText("2.000");
    await expect(revenue.getByRole("row", { name: new RegExp(`${year} total`) })).toContainText("3.000");
    const profit = card("Gross profit");
    await expect(profit.getByRole("row", { name: /Q1/ })).toContainText("40"); // 10% of 400
    await expect(profit.getByRole("row", { name: /Q2/ })).toContainText("Not set");

    await page.reload(); // the saved targets come back into the form
    await expect(page.getByLabel("Q1 revenue target")).toHaveValue("1.000");
  });

  test("the progress chart names the steps without their percentages", async ({ page }) => {
    await signIn(page, "SALES");
    await page.goto("/dashboard/sales?view=charts");

    const chart = page.locator("section[aria-label='Pipeline charts'] > div").filter({ has: page.getByRole("heading", { name: "Pipeline by progress" }) });
    await expect(chart.getByText("Propose", { exact: true })).toBeVisible();
    await expect(chart.getByText("Negotiate (FU)", { exact: true })).toBeVisible();
    await expect(chart.getByText(/\d+% - /)).toHaveCount(0);
  });

  test("the pipeline tiles open the project table filtered", async ({ page }) => {
    await signIn(page, "SALES");
    await page.goto("/dashboard/sales");
    const tiles = page.getByRole("region", { name: "Pipeline numbers" });

    for (const [name, show] of [["Open pipeline", "pipeline"], ["Estimated gross profit", "margin"], ["Won", "won"]] as const) {
      await expect(async () => {
        await page.goto("/dashboard/sales");
        await tiles.getByRole("link", { name: new RegExp(`^${name}`, "i") }).click();
        await expect(page).toHaveURL(new RegExp(`/projects\\?show=${show}&mine=1$`), { timeout: 3000 });
      }).toPass();
      await expect(page.getByRole("status")).toContainText("yours");
    }
  });

  test("only the superadmin sees the team settings, and a template without the Request ID is refused", async ({ page, browser }) => {
    await signIn(page, "SALES");
    await expectNotFound(page, "/admin/settings", "Email subject");

    const root = await asRole(browser, "SUPERADMIN");
    await root.goto("/admin/settings");
    await expect(root.getByRole("heading", { level: 1, name: "SLA Policies" })).toBeVisible();
    const form = root.locator("form").filter({ has: root.getByRole("button", { name: "Save SOA settings" }) });
    await expect(form.getByLabel(/^SLA of the SOA team/)).toHaveValue("2-3"); // the default range
    await expect(async () => {
      await form.getByLabel("Email subject").fill("A subject without the id");
      await form.getByRole("button", { name: "Save SOA settings" }).click();
      await expect(root.getByRole("alert").filter({ hasText: "{{request_id}}" })).toBeVisible({ timeout: 1500 });
    }).toPass();
    await expect(root.getByText("Preview with sample data").first()).toBeVisible();
    await root.context().close();
  });

  test("only the superadmin can move a project to other PICs, and nothing else changes", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Move me");
    await expect(page.getByRole("button", { name: "Move project" })).toHaveCount(0);

    const root = await asRole(browser, "SUPERADMIN");
    await root.goto(`/projects/${projectCode}`);
    const soa = root.getByLabel("SOA PIC (technical)");
    await expect(soa).toBeVisible();
    // A click before the page is interactive reloads it and resets the box, so the choice is made again on every try.
    await expect(async () => {
      const options = await soa.locator("option").evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean));
      await soa.selectOption(options[options.length - 1]!);
      await root.getByRole("button", { name: "Move project" }).click();
      await expect(root.getByRole("status").filter({ hasText: /was moved/ })).toBeVisible({ timeout: 1500 });
    }).toPass();

    await root.reload();
    await expect(root.locator("#overview").getByText("Technical PIC (SOA)", { exact: true }).locator("..")).not.toContainText("–");
    await expect(root.getByRole("heading", { name: "Move me – ", exact: false }).or(root.getByText("Move me").first())).toBeVisible();
    await root.context().close();
  });

  test("only the superadmin can delete a project, and it then disappears", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Delete me");
    await expect(page.getByRole("button", { name: "Delete project" })).toHaveCount(0);

    const root = await asRole(browser, "SUPERADMIN");
    await root.goto(`/projects/${projectCode}`);
    await expect(async () => {
      await root.getByRole("button", { name: "Delete project" }).first().click();
      await expect(root.getByLabel(`Type ${projectCode} to confirm`)).toBeVisible({ timeout: 1000 });
    }).toPass();
    await root.getByLabel(`Type ${projectCode} to confirm`).fill(projectCode);
    await root.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
    await expect(root).toHaveURL(/\/projects$/);
    await expect(root.getByRole("link", { name: projectCode, exact: true })).toHaveCount(0);

    await page.goto(`/projects/${projectCode}`);
    await expect(page.getByText("Delete me")).toHaveCount(0);
    await root.context().close();
  });

  test("the overview exports the projects with only the ticked columns", async ({ page }) => {
    await signIn(page, "FINANCE");
    await page.goto("/dashboard");
    const form = page.locator("form[action='/export/projects']");
    await expect(form).toBeHidden(); // the column picker is not on the page until it is asked for
    await expect(async () => {
      await page.getByRole("button", { name: "Export data" }).click();
      await expect(form).toBeVisible({ timeout: 1000 });
    }).toPass();

    await form.getByRole("button", { name: "Clear" }).click();
    await expect(form.getByLabel("Project ID")).not.toBeChecked();
    await form.getByLabel("Project ID").check();
    await form.getByLabel("Estimated PO Value").check();
    const downloading = page.waitForEvent("download");
    await form.getByRole("button", { name: /Export Excel/ }).click();
    const download = await downloading;

    expect(download.suggestedFilename()).toMatch(/^halcom-projects-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const sheet = strFromU8(unzipSync(new Uint8Array(readFileSync((await download.path())!)))["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("Project ID");
    expect(sheet).toContain("Estimated PO Value");
    expect(sheet).not.toContain("Account Name"); // only the ticked columns
    expect(sheet.match(/<row /g)!.length).toBeGreaterThan(1); // the header and at least one project
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
    await expect(page.locator("#overview").getByText("Sales PIC", { exact: true })).toBeVisible();

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
    // Technical details are optional: only the ones that have text are shown, the others are added when needed.
    await expect(soa.getByRole("textbox", { name: "Technical notes" })).toHaveCount(0);
    await soa.getByRole("button", { name: "Add BOQ", exact: true }).click();
    await soa.getByLabel("BOQ", { exact: true }).fill("In progress");
    await soa.getByRole("button", { name: "Add Technical notes" }).click();
    await soa.getByLabel("Technical notes", { exact: true }).fill("Sized for 400 users");
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

  test("a direct RFQ goes to Purchasing with its own tag and numbering, and a PO is not offered before the RFQ is completed", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Access control");

    const rfq = await createRequest(page, projectCode, "RFQ", "Quote 10 readers");
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(subjectPattern("RFQ", "Access control"));
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("purchasing-group@example.invalid");
    await expect(page.getByLabel("Cc", { exact: true })).toHaveValue("");

    expect(rfq).toMatch(/^RFQ-SA-/);

    // The flow is BOQ -> RFQ -> PO: the BOQ was skipped, but a PO waits for the RFQ to be completed.
    await page.goto(`/projects/${projectCode}`);
    await expect(page.getByRole("link", { name: "New RFQ", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "New PO", exact: true })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Flow of this project" })).toContainText("BOQSkipped");
  });

  test("SOA completes a BOQ and hands it over as an RFQ that keeps the link to the BOQ", async ({ page, browser }) => {
    test.setTimeout(120_000); // four signed-in users and several cold page compiles
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Handover demo");
    const boq = await createRequest(page, projectCode, "BOQ", "BOQ for handover");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/request/${boq}`);
    await expect(soa.getByRole("button", { name: "Continue to RFQ" })).toHaveCount(0); // not completed yet
    await moveCard(soa, "BOQ", boq, "IN_PROGRESS");
    await moveCard(soa, "BOQ", boq, "COMPLETED");

    await soa.goto(`/request/${boq}`);
    await soa.getByRole("button", { name: "Continue to RFQ" }).click();
    await expect(soa).toHaveURL(/\/request\/RFQ-[A-Z0-9]+-\d{6,}$/);
    const rfq = soa.url().split("/").pop()!;

    await expect(soa.getByLabel("Subject", { exact: true })).toHaveValue(subjectPattern("RFQ", "Handover demo"));
    await expect(soa.getByLabel("To", { exact: true })).toHaveValue("purchasing-group@example.invalid");
    expect(await soa.getByLabel("Text", { exact: true }).inputValue()).toContain(`Source BOQ   : ${boq} (completed)`);
    await soa.getByRole("button", { name: /Send email/ }).click(); // the email text is in a modal
    await expect(soa.getByText("Reply inside the original [HITBOQ] email thread")).toBeVisible();
    await expect(soa.getByRole("link", { name: boq })).toBeVisible();

    // The BOQ now lists its RFQ, and the next-step buttons are gone: it has been continued.
    await soa.goto(`/request/${boq}`);
    await expect(soa.getByRole("link", { name: rfq })).toBeVisible();
    await expect(soa.getByRole("button", { name: /^Continue to/ })).toHaveCount(0);

    // Purchasing sees it and works on it; Finance sees it read-only.
    const purchasing = await asRole(browser, "PURCHASING");
    await purchasing.goto(`/request/${rfq}`);
    // A handed-over request arrives In progress by itself: the team only has to complete it.
    await expect(purchasing.getByText("Status is In progress.")).toBeVisible();
    await moveCard(purchasing, "RFQ", rfq, "COMPLETED");
    await purchasing.goto(`/request/${rfq}`);
    await expect(purchasing.getByLabel("Subject", { exact: true })).toHaveCount(0); // Purchasing does not send these emails

    const finance = await asRole(browser, "FINANCE");
    await finance.goto(`/request/${rfq}`);
    await expect(finance.getByRole("heading", { level: 1, name: rfq })).toBeVisible();
    await expect(finance.getByText(/dragging this request/)).toHaveCount(0); // Finance only reads
    await expect(finance.getByLabel("Subject", { exact: true })).toHaveCount(0);
    await soa.context().close();
    await purchasing.context().close();
    await finance.context().close();
  });

  test("Sales decide the next step of a completed BOQ and RFQ, and can change their mind", async ({ page, browser }) => {
    test.setTimeout(180_000); // two signed-in users and several cold page compiles
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Flow demo");
    const boq = await createRequest(page, projectCode, "BOQ", "BOQ for the flow");

    // SOA completes it on the board; there is no Waiting for Sales column any more.
    const soa = await asRole(browser, "SOA");
    await soa.goto(`/requests/boq?view=board&q=${boq}`);
    await expect(soa.locator('[data-column="WAITING_FOR_SALES"]')).toHaveCount(0);
    await moveCard(soa, "BOQ", boq, "IN_PROGRESS");
    await moveCard(soa, "BOQ", boq, "COMPLETED");

    // The BOQ is done: Sales decide whether it continues to an RFQ. They say no, and the project's flow shows it.
    await page.goto(`/request/${boq}`);
    await expect(page.getByRole("heading", { name: "What happens next?" })).toBeVisible();
    await expect(async () => {
      await page.getByLabel("Note (optional)").fill("Customer postponed");
      await page.getByRole("button", { name: "Do not continue" }).click();
      await expect(page.getByRole("status").filter({ hasText: "does not continue" })).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 40_000 });
    await page.goto(`/projects/${projectCode}`);
    await expect(page.getByRole("list", { name: "Flow of this project" })).toContainText("Not continuing");
    await page.goto("/dashboard/sales");
    // Decided, so this BOQ is no longer listed (other BOQs of the shared Sales account may be).
    await expect(page.getByRole("link", { name: new RegExp("^" + boq + " ·") })).toHaveCount(0);

    // They change their mind: continue to the RFQ anyway.
    await page.goto(`/request/${boq}`);
    await expect(page.getByText("Not continuing – decided by")).toBeVisible();
    await expect(async () => {
      await page.getByRole("button", { name: "Continue to RFQ anyway" }).click();
      await expect(page).toHaveURL(/\/request\/RFQ-[A-Z0-9]+-\d{6,}$/, { timeout: 15_000 });
    }).toPass({ timeout: 40_000 });
    await page.goto(`/projects/${projectCode}`);
    await expect(page.getByRole("list", { name: "Flow of this project" })).toContainText("BOQDone");
    await soa.context().close();
  });

  test("SOA revise a completed BOQ on the board; an RFQ has no Revision column", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Revision demo");
    const boq = await createRequest(page, projectCode, "BOQ", "BOQ to revise");
    const rfq = await createRequest(page, projectCode, "RFQ", "RFQ without revision");

    const soa = await asRole(browser, "SOA");
    // Revision exists only after Completed: a fresh card cannot be dropped on it, a completed one can.
    await moveCard(soa, "BOQ", boq, "COMPLETED");
    await moveCard(soa, "BOQ", boq, "REVISION"); // no reason is asked: revision details go by email
    await expect(soa.getByRole("dialog")).toHaveCount(0);
    await soa.goto(`/request/${boq}`);
    await expect(soa.getByText("Status is Revision.")).toBeVisible();
    await expect(soa.getByRole("button", { name: /^Continue to/ })).toHaveCount(0); // continue once the revision is completed again
    await moveCard(soa, "BOQ", boq, "COMPLETED");
    await soa.goto(`/request/${boq}`);
    await soa.getByText(/^Status history/).click();
    await expect(soa.getByRole("table").getByRole("cell", { name: "Revision" }).first()).toBeVisible();

    const purchasing = await asRole(browser, "PURCHASING");
    await purchasing.goto(`/requests/rfq?view=board&q=${rfq}`);
    await expect(purchasing.locator(`[data-request="${rfq}"]`)).toBeVisible();
    await expect(purchasing.locator('[data-column="REVISION"]')).toHaveCount(0);
    await expect(purchasing.locator('[data-column="SUBMITTED"]')).toBeVisible();
    await soa.context().close();
    await purchasing.context().close();
  });

  test("cancelling a card on the board asks for a reason, which the history keeps", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Reason demo");
    const boq = await createRequest(page, projectCode, "BOQ", "BOQ needing a reason");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/requests/boq?view=board&q=${boq}`);
    const card = soa.locator(`[data-request="${boq}"]`);
    await expect(card).toBeVisible();
    await expect(async () => {
      await card.dragTo(soa.locator('[data-column="CANCELLED"]'));
      await expect(soa.getByRole("dialog", { name: `Cancel ${boq}?` })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 40_000 });
    // It cannot be confirmed without a reason, and keeping it as it is leaves the card where it was.
    await expect(soa.getByRole("button", { name: "Cancel request" })).toBeDisabled();
    await soa.getByRole("button", { name: "Keep it as it is" }).click();
    await expect(soa.locator(`[data-column="SUBMITTED"] [data-request="${boq}"]`)).toBeVisible();

    await moveCard(soa, "BOQ", boq, "CANCELLED", "Customer cancelled the tender");
    await soa.goto(`/request/${boq}`);
    await soa.getByText(/^Status history/).click(); // the history is collapsed at the end of the page
    await expect(soa.getByRole("cell", { name: "Customer cancelled the tender" })).toBeVisible();
    // Cancelled is final: the card cannot be dragged on.
    await soa.goto(`/requests/boq?view=board&q=${boq}`);
    await expect(soa.locator(`[data-column="CANCELLED"] [data-request="${boq}"]`)).toHaveAttribute("draggable", "false");
    await soa.context().close();
  });

  test("Finance sees the board but cannot drag a card", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Read only board");
    const boq = await createRequest(page, projectCode, "BOQ", "BOQ on a read-only board");

    const finance = await asRole(browser, "FINANCE");
    await finance.goto(`/requests/boq?view=board&q=${boq}`);
    await expect(finance.locator(`[data-request="${boq}"]`)).toHaveAttribute("draggable", "false");
    await finance.context().close();
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
    await user.getByRole("button", { name: "Profile menu" }).click();
    await user.getByRole("link", { name: "Account" }).click();
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
      "Customers",
      "Sales Targets",
      "Request Center",
    ]);
    await expect(page).toHaveTitle("Halcom Dashboard");

    // Profile and notifications are in the navbar, not the sidebar.
    const navbar = page.getByRole("banner");
    await expect(navbar.getByRole("link", { name: /^Notifications/ })).toBeVisible();
    await expect(navbar.getByRole("button", { name: "Profile menu" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Profile menu" })).toHaveCount(0);

    // The sidebar can be hidden and shown again.
    await navbar.getByRole("button", { name: "Hide sidebar" }).click();
    await expect(nav).toBeHidden();
    await navbar.getByRole("button", { name: "Show sidebar" }).click();
    await expect(nav).toBeVisible();
  });

  test("on a phone the sidebar is a drawer that opens from the menu button and closes after navigating", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn(page, "SALES");

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    const opener = page.getByRole("button", { name: "Open menu" });
    await expect(opener).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: /^Notifications/ })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Profile menu" })).toBeVisible();

    await opener.click(); // may need a retry before hydration
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

    await opener.click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

    expect(errors).toEqual([]);

    // No sideways scrolling of the page itself.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
