import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNotFound, expectOnDashboard, SEED_PASSWORD, signIn, signInAs } from "./helpers";
import { seedEmailFor } from "../../prisma/seed-users";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function asRole(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

async function sessionCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "session");
}

test.describe("persistent login and switching accounts", () => {
  test("the session cookie is HttpOnly, SameSite=Lax and persistent, and survives a browser restart", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const cookie = await sessionCookie(page);

    expect(cookie).toBeTruthy();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    // A persistent cookie (not a browser-session one) that lasts the configured twelve hours.
    const hoursLeft = (cookie!.expires - Date.now() / 1000) / 3600;
    expect(hoursLeft).toBeGreaterThan(11);
    expect(hoursLeft).toBeLessThanOrEqual(12.1);

    // A "restart": a brand new browser context that only has the persistent cookies.
    const state = await page.context().storageState();
    const restarted = await browser.newContext({ storageState: state });
    const again = await restarted.newPage();
    await again.goto("/dashboard/sales");
    await expectOnDashboard(again, "/dashboard/sales", "Sales Pipeline");
    await restarted.close();
  });

  test("the signed-in user keeps their session between pages, and nothing about the session is in web storage", async ({ page }) => {
    await signIn(page, "SOA");
    await page.goto("/projects");
    await page.goto("/requests/boq");
    await expect(page.getByRole("heading", { level: 1, name: "BOQ Tickets" })).toBeVisible();

    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(stored.toLowerCase()).not.toMatch(/password|token|session=|e2e-seed/);
    const cookie = await sessionCookie(page);
    expect(stored).not.toContain(cookie!.value);
  });

  test("Switch Account ends the session, asks for the next account's password, and shows nothing of the previous user", async ({ page, context }) => {
    await signIn(page, "SALES");
    await expectOnDashboard(page, "/dashboard/sales", "Sales Pipeline");
    const oldCookie = (await sessionCookie(page))!;

    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("button", { name: "Switch account" }).click();

    // The session is over: the login page is shown with the account used here as a quick pick.
    await expect(page).toHaveURL(/\/login\?switch=1$/);
    await expect(page.getByRole("heading", { name: "Switch account" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(seedEmailFor("SALES")) })).toBeVisible();
    expect(await sessionCookie(page)).toBeUndefined();
    await page.goto("/dashboard/sales");
    await expect(page).toHaveURL(/\/login$/);

    // The old cookie is revoked on the server, not merely deleted in this browser.
    await context.addCookies([oldCookie]);
    await page.goto("/dashboard/sales");
    await expect(page).toHaveURL(/\/login$/);
    await context.clearCookies({ name: "session" });

    // Picking the account only fills the email; the password is still required, and a wrong one signs nobody in.
    await page.goto("/login?switch=1");
    await page.getByRole("link", { name: new RegExp(seedEmailFor("SALES")) }).click();
    await expect(page.getByLabel("Email")).toHaveValue(seedEmailFor("SALES"));
    await expect(page.getByLabel("Password")).toBeFocused();
    // A click before the form is interactive reloads the page (and drops the typed text), so the attempt is repeated.
    await expect(async () => {
      await page.getByLabel("Password").fill("not-the-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    expect(await sessionCookie(page)).toBeUndefined();

    // Signing in as another user shows that user's identity and role, and none of the previous user's data.
    await signInAs(page, seedEmailFor("FINANCE"), SEED_PASSWORD);
    await expectOnDashboard(page, "/dashboard/finance", "Finance Dashboard");
    await page.getByRole("button", { name: "Profile menu" }).click();
    await expect(page.locator("#profile-menu").getByText("Dev Finance")).toBeVisible();
    // Nothing of the previous user's dashboard is left in the page, not even hidden in the browser's page cache...
    expect(await page.content()).not.toContain("Your requests by status");
    // ...and going back in the history cannot bring it back: the sign-in page sends a signed-in person to their own dashboard.
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/finance$/);
    expect(await page.content()).not.toContain("Your requests by status");
    await expect(nav(page).getByRole("link", { name: "Sales Pipeline" })).toHaveCount(0);
    await expectNotFound(page, "/dashboard/sales", "Request counts");
    await expectNotFound(page, "/targets", "My 2026 targets");
  });

  test("Sign out revokes the session and does not bring the previous user back", async ({ page, context }) => {
    await signIn(page, "PURCHASING");
    const oldCookie = (await sessionCookie(page))!;

    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await context.addCookies([oldCookie]);
    await page.goto("/dashboard/purchasing");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a stale tab learns that the session is gone when the page asks for a renewal", async ({ page, context }) => {
    await signIn(page, "FINANCE");
    const response = await page.request.post("/api/session/renew");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toMatchObject({ signedIn: true });

    await context.clearCookies({ name: "session" });
    const gone = await page.request.post("/api/session/renew");
    expect(gone.status()).toBe(401);
    expect(await gone.json()).toEqual({ signedIn: false });
  });

  test("the quick-pick list can be cleared from the sign-in page", async ({ page }) => {
    await signIn(page, "MANAGEMENT");
    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("button", { name: "Switch account" }).click();
    await expect(page.getByRole("link", { name: new RegExp(seedEmailFor("MANAGEMENT")) })).toBeVisible();

    await page.getByRole("button", { name: "Forget all accounts on this browser" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Switch account" })).toHaveCount(0);
  });

  test("a role cannot be gained from the URL: an address that names another role's page shows not-found", async ({ page }) => {
    await signIn(page, "PURCHASING");

    await expectNotFound(page, "/dashboard/soa?role=SOA", "Awaiting handoff");
    await expectNotFound(page, "/handoffs", "Ready for handoff");
    await expectNotFound(page, "/finance/crosscheck?role=FINANCE", "Financial Crosscheck");
    await expectNotFound(page, "/admin/permissions", "Role permission matrix");
    await expectNotFound(page, "/targets", "Revenue target");
  });
});

test.describe("each role sees its own modules", () => {
  const MODULES = {
    SALES: ["Overview", "Sales Pipeline", "Projects", "Customers", "Sales Targets", "Request Center"],
    SOA: ["Overview", "Technical Dashboard", "Projects", "New project", "BOQ Tickets", "New BOQ request", "Purchasing Handoff", "Technical Reports", "Principal & Solution Master Data"],
    PURCHASING: ["Purchasing Dashboard", "RFQ Requests", "PO requests"],
    FINANCE: ["Overview", "Finance Dashboard", "Projects", "All requests", "BOQ requests", "RFQ requests", "PO requests", "Financial Crosscheck"],
  } as const;

  for (const [role, labels] of Object.entries(MODULES)) {
    test(`${role} sees ${labels.length} modules`, async ({ page }) => {
      await signIn(page, role as keyof typeof MODULES);
      await expect(nav(page).getByRole("link")).toHaveText([...labels]);
    });
  }

  test("an admin sees the administration modules", async ({ page }) => {
    await signIn(page, "ADMIN");
    for (const name of ["Users and Roles", "Permissions", "SLA Policies", "Master Data", "Audit Logs"]) {
      await expect(nav(page).getByRole("link", { name })).toBeVisible();
    }
    await expect(nav(page).getByRole("link", { name: "Backups" })).toHaveCount(0);
  });

  test("the admin sees the permission matrix and reads the SLA policies without a way to change them", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.goto("/admin/permissions");
    await expect(page.getByRole("heading", { level: 1, name: "Permissions" })).toBeVisible();
    const finance = page.getByRole("row", { name: /finance\.crosscheck\.view/ });
    await expect(finance).toBeVisible();

    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { level: 1, name: "SLA Policies" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
    await expect(page.getByText("only a superadmin changes them")).toBeVisible();
  });
});

test.describe("dashboards use the stored requests", () => {
  test("SOA's technical dashboard counts a new BOQ and every number links to the filtered list", async ({ browser }) => {
    test.setTimeout(120_000);
    const sales = await asRole(browser, "SALES");
    const soa = await asRole(browser, "SOA");

    await soa.goto("/dashboard/soa");
    await expect(soa.getByRole("heading", { level: 1, name: "Technical Dashboard" })).toBeVisible();
    const tile = soa.getByRole("link", { name: /^Open BOQ requests/ });
    const before = Number((await tile.innerText()).match(/\n(\d+)\n/)?.[1] ?? "0");

    // Sales raise a project with a BOQ in one go.
    await sales.goto("/projects/new");
    await expect(async () => {
      await sales.getByLabel("End-user company").fill("PT Dashboard Uji");
      await sales.getByLabel("Project name").fill("Count me");
      await sales.getByText(/^BOQ – /).click();
      await sales.getByLabel("Request summary").fill("Counted BOQ");
      await sales.getByRole("button", { name: /Create project and BOQ request/ }).click();
      await expect(sales).toHaveURL(/\/request\/BOQ-/, { timeout: 4000 });
    }).toPass({ timeout: 45_000 });

    await soa.reload();
    const after = Number((await tile.innerText()).match(/\n(\d+)\n/)?.[1] ?? "-1");
    expect(after).toBe(before + 1);

    await tile.click();
    await expect(soa).toHaveURL(/\/requests\/boq\?status=open$/);
    await expect(soa.getByRole("heading", { level: 1, name: "BOQ Tickets" })).toBeVisible();
    // SOA open their ticket list as the board, where statuses are changed; the table is one click away.
    await expect(soa.getByRole("group", { name: "Request board" })).toBeVisible();
    await soa.getByRole("navigation", { name: "View" }).getByRole("link", { name: "List" }).click();
    // The list has pages of 20; the line under it counts all of them.
    await expect(soa.getByRole("link", { name: /^BOQ-/ })).toHaveCount(Math.min(after, 20));
    await expect(soa.getByRole("status").filter({ hasText: `of ${after}` })).toBeVisible();

    // The board shows the same requests as columns.
    await soa.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Board" }).click();
    await expect(soa.getByRole("group", { name: "Request board" })).toBeVisible();
    await expect(soa.getByRole("region", { name: /^Submitted, \d+ request/ })).toBeVisible();
  });

  test("Purchasing's dashboard and Finance's dashboard open and show their own numbers", async ({ browser }) => {
    const purchasing = await asRole(browser, "PURCHASING");
    await purchasing.goto("/dashboard/purchasing");
    await expect(purchasing.getByRole("heading", { level: 1, name: "Purchasing Dashboard" })).toBeVisible();
    await expect(purchasing.getByRole("link", { name: /^Open RFQ requests/ })).toBeVisible();
    await expect(purchasing.getByText("SLA compliance")).toBeVisible();
    await expect(purchasing.getByRole("heading", { name: "Workload by assignee" })).toBeVisible();

    const finance = await asRole(browser, "FINANCE");
    await finance.goto("/dashboard/finance");
    await expect(finance.getByRole("heading", { level: 1, name: "Finance Dashboard" })).toBeVisible();
    await finance.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Financial Crosscheck" }).click();
    await expect(finance.getByRole("heading", { level: 1, name: "Financial Crosscheck" })).toBeVisible();
    // Read-only: nothing on the page changes a project or a request.
    await expect(finance.getByRole("button", { name: /Save|Delete|Approve|Verify/ })).toHaveCount(0);
    await expect(finance.getByRole("link", { name: "Download CSV" })).toBeVisible();
  });

  test("Sales' dashboard shows target versus achievement and requests by status", async ({ browser }) => {
    const sales = await asRole(browser, "SALES");
    await sales.goto("/dashboard/sales");
    await expect(sales.getByRole("region", { name: /^Target versus achievement/ })).toBeVisible();
    await expect(sales.getByRole("region", { name: "Your requests by status" })).toBeVisible();
    await sales.getByRole("link", { name: "Sales Targets" }).first().click();
    await expect(sales.getByRole("heading", { level: 1, name: "Sales Targets" })).toBeVisible();
    await expect(sales.getByRole("heading", { name: /^My \d{4} targets$/ })).toBeVisible();
  });
});

test.describe("a project from another source (Other)", () => {
  test("SOA registers it without a Sales PIC, raises its BOQ, and everyone can find it by source", async ({ browser }) => {
    test.setTimeout(150_000);
    const soa = await asRole(browser, "SOA");
    const stamp = Date.now();
    const company = `PT Eksternal ${stamp}`;
    const source = `PT Mitra Penjualan ${stamp}`; // unique per run, so the search below finds exactly this project

    await soa.goto("/projects/new");
    await expect(soa.getByRole("heading", { level: 1, name: "New project" })).toBeVisible();
    // SOA register only projects from another source: the source is fixed, the external fields show, Sales' commercial fields do not.
    await expect(soa.getByLabel("Sales name *")).toBeVisible();
    await expect(soa.getByLabel("Estimated PO value")).toHaveCount(0);
    await expect(soa.getByLabel("Progress")).toHaveCount(0);

    await expect(async () => {
      await soa.getByLabel("End-user company").fill(company);
      await soa.getByLabel("Project name").fill("Dari mitra");
      await soa.getByLabel("Sales name *").fill(source);
      await soa.getByLabel("Sales contact").fill("Budi");
      await soa.getByLabel("Reference").fill("MP-2026-7");
      await soa.getByText(/^BOQ – /).click();
      await soa.getByLabel("Request summary").fill("BOQ untuk mitra");
      await soa.getByRole("button", { name: /Create project and BOQ request/ }).click();
      await expect(soa).toHaveURL(/\/request\/BOQ-/, { timeout: 4000 });
    }).toPass({ timeout: 60_000 });

    // The project page names the source and has no internal Sales PIC; SOA's source form is there.
    await soa.getByRole("link", { name: /^PRJ-\d+/ }).first().click();
    await expect(soa.getByText("None (project from another source)")).toBeVisible();
    await expect(soa.getByText(source).first()).toBeVisible();
    await expect(soa.getByText("MP-2026-7").first()).toBeVisible();
    await expect(soa.getByRole("heading", { name: "Project source" })).toBeVisible();
    const projectUrl = soa.url();

    // Searchable and filterable for everyone who reads projects, and Finance cannot create or edit it.
    const finance = await asRole(browser, "FINANCE");
    await finance.goto(`/projects?q=${encodeURIComponent(source)}&source=OTHER`);
    await expect(finance.getByRole("link", { name: /^PRJ-\d+/ })).toHaveCount(1);
    await expect(finance.getByRole("cell", { name: "Other", exact: true })).toBeVisible();
    await finance.goto(`/projects?source=INTERNAL_SALES&q=${encodeURIComponent(source)}`);
    await expect(finance.getByText("No project matches these filters.")).toBeVisible();
    await finance.goto(projectUrl);
    await expect(finance.getByRole("heading", { name: "Project source" })).toHaveCount(0);
    await expectNotFound(finance, "/projects/new", "Project details");

    // Any salesperson can work on a project whose sales is Other: its source section and commercial form are there.
    const sales = await asRole(browser, "SALES");
    await sales.goto(projectUrl);
    await expect(sales.getByRole("heading", { name: "Project source" })).toBeVisible();
    await expect(sales.locator("#commercial").getByLabel("Estimated PO value")).toBeVisible();

    // SOA edits the source details; the change shows in the change log.
    await soa.goto(projectUrl);
    await expect(async () => {
      await soa.getByLabel("Sales contact").fill("Siti");
      await soa.getByRole("button", { name: "Save source" }).click();
      await expect(soa.getByRole("status").filter({ hasText: "Saved and logged." })).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 45_000 });
    await soa.reload();
    await expect(soa.getByText("Sales contact").first()).toBeVisible();
    await expect(soa.getByRole("list", { name: "Change log" })).toContainText("Siti");
  });

  test("Sales pick themselves or Other and name the sales; the customer appears on the Customers page", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, "SALES");
    const company = `PT Pelanggan ${Date.now()}`;
    await page.goto("/projects/new");
    const source = page.getByLabel("Project source");
    await expect(source).toHaveValue("INTERNAL_SALES");
    await expect(page.getByLabel("Sales name *")).toHaveCount(0);
    await expect(page.getByLabel("Estimated PO value")).toBeVisible();
    await source.selectOption("OTHER");
    await expect(page.getByLabel("Sales name *")).toBeVisible();

    await expect(async () => {
      await page.getByLabel("End-user company").fill(company);
      await page.getByLabel("Project name").fill("Lewat mitra");
      await page.getByLabel("Sales name *").fill("Budi Mitra");
      await page.getByRole("button", { name: "Create project" }).click();
      await expect(page).toHaveURL(/\/projects\/PRJ-\d+$/, { timeout: 4000 });
    }).toPass({ timeout: 45_000 });
    await expect(page.getByText("None (project from another source)")).toBeVisible();

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Customers" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await page.getByPlaceholder("Search customers").fill(company);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("link", { name: company })).toBeVisible();
  });

  test("Customers are closed to SOA and Finance", async ({ browser }) => {
    for (const role of ["SOA", "FINANCE"] as const) {
      const other = await asRole(browser, role);
      await expectNotFound(other, "/customers", "Search customers");
    }
  });

  test("an admin chooses the source when creating a project", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.goto("/projects/new");
    const source = page.getByLabel("Project source");
    await expect(source).toHaveValue("INTERNAL_SALES");
    await expect(page.getByLabel("Sales name *")).toHaveCount(0);
    await source.selectOption("OTHER");
    await expect(page.getByLabel("Sales name *")).toBeVisible();
    await source.selectOption("INTERNAL_SALES");
    await expect(page.getByLabel("Sales name *")).toHaveCount(0);
  });
});
