import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { toXlsx } from "@/server/export/xlsx";
import { expectNotFound, signIn } from "./helpers";
import { seedEmailFor } from "../../prisma/seed-users";

const tag = () => randomBytes(3).toString("hex");

async function asRole(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

/** Creates a project as the signed-in Sales user and returns its Project ID. */
async function createProject(page: Page, company: string, name: string): Promise<string> {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill(company);
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/PRJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return page.url().split("/").pop()!;
}

async function createBoq(page: Page, projectCode: string, title: string): Promise<string> {
  await page.goto(`/projects/${projectCode}`);
  await page.getByRole("link", { name: "New BOQ", exact: true }).click();
  await expect(page.getByLabel("Request type")).toHaveValue("BOQ");
  await expect(async () => {
    await page.getByLabel("Summary").fill(title);
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\/projects\/PRJ-\d+\?request=BOQ-[A-Z0-9]+-\d{6,}/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return new URL(page.url()).searchParams.get("request")!;
}

const card = (page: Page, heading: string) => page.getByRole("heading", { level: 2, name: heading }).locator("xpath=ancestor::*[@data-slot='card'][1]");

test.describe("several principals on a project", () => {
  test("SOA adds two principals (one created on purpose), saves, sees both after a reload, and removes one", async ({ browser }) => {
    test.setTimeout(180_000);
    const id = tag();
    const sales = await asRole(browser, "SALES");
    const code = await createProject(sales, `PT Brands ${id}`, "Two brands");
    await sales.context().close();

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/projects/${code}`);
    const combobox = soa.getByRole("combobox", { name: "Principals" });
    for (const name of [`Alpha ${id}`, `Beta ${id}`]) {
      await expect(async () => {
        await combobox.click();
        await combobox.fill(name);
        await expect(soa.getByRole("button", { name: new RegExp(`Create Principal .${name}.`) })).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 30_000 });
      await soa.getByRole("button", { name: new RegExp(`Create Principal .${name}.`) }).click();
      await expect(soa.getByRole("list", { name: "Chosen principals" })).toContainText(name);
    }
    await expect(async () => {
      await soa.getByRole("button", { name: "Save classification" }).click();
      await expect(soa.getByText(/Saved and logged|Nothing changed/)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30_000 });

    await soa.reload();
    const chosen = soa.getByRole("list", { name: "Chosen principals" });
    await expect(chosen).toContainText(`Alpha ${id}`);
    await expect(chosen).toContainText(`Beta ${id}`);
    await expect(soa.locator("#overview").getByText(`Alpha ${id}, Beta ${id}`)).toBeVisible();

    // The Projects list shows both, and either one finds the project.
    await soa.goto(`/projects?q=${encodeURIComponent(`Beta ${id}`)}`);
    await expect(soa.getByRole("row").filter({ hasText: code })).toContainText(`Alpha ${id}, Beta ${id}`);

    // Removing one keeps the other; a principal that is chosen is not offered twice.
    await soa.goto(`/projects/${code}`);
    await soa.getByRole("button", { name: `Remove Alpha ${id}` }).click();
    await expect(async () => {
      await soa.getByRole("button", { name: "Save classification" }).click();
      await expect(soa.getByText("Saved and logged")).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30_000 });
    await soa.reload();
    await expect(soa.getByRole("list", { name: "Chosen principals" })).not.toContainText(`Alpha ${id}`);
    await expect(soa.getByRole("list", { name: "Chosen principals" })).toContainText(`Beta ${id}`);
    await soa.context().close();
  });
});

test.describe("PICs for SOA and Purchasing", () => {
  test("an administrator adds a PIC; the shared SOA login hands a BOQ to it; the history keeps it after it is deactivated", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const id = tag();
    await signIn(page, "SALES");
    const project = await createProject(page, `PT Pic ${id}`, "PIC demo");
    const boq = await createBoq(page, project, "BOQ for the PIC demo");

    const admin = await asRole(browser, "ADMIN");
    await admin.goto("/admin/pics");
    await expect(admin.getByRole("heading", { level: 1, name: "PICs" })).toBeVisible();
    const soaCard = card(admin, "SOA PICs");
    for (const name of [`Adityo ${id}`, `Ibnu ${id}`]) {
      await expect(async () => {
        await soaCard.getByLabel("New SOA PIC").fill(name);
        await soaCard.getByRole("button", { name: "Add PIC" }).click();
        await expect(soaCard.getByLabel(`Name of ${name}`)).toBeVisible({ timeout: 4000 });
      }).toPass({ timeout: 30_000 });
    }
    // The same name twice in one team is refused with a message.
    await soaCard.getByLabel("New SOA PIC").fill(`ADITYO  ${id}`);
    await soaCard.getByRole("button", { name: "Add PIC" }).click();
    await expect(soaCard.getByRole("alert")).toContainText("already has a PIC");

    // SOA signs in with the shared account and hands the BOQ to a PIC (not to an account).
    const soa = await asRole(browser, "SOA");
    await soa.goto(`/request/${boq}`);
    const form = soa.getByRole("heading", { level: 3, name: "PIC", exact: true }).locator("xpath=ancestor::*[@data-slot='card'][1]");
    await expect(async () => {
      await form.getByLabel("PIC").selectOption({ label: `Adityo ${id}` });
      await form.getByRole("button", { name: "Save PIC" }).click();
      await expect(form.getByText("PIC saved.")).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30_000 });
    await soa.reload();
    await expect(soa.locator("dl").getByText(`Adityo ${id}`)).toBeVisible();
    await expect(async () => {
      await form.getByLabel("PIC").selectOption({ label: `Ibnu ${id}` });
      await form.getByRole("button", { name: "Save PIC" }).click();
      await expect(form.getByText("PIC saved.")).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30_000 });

    // The workload on the SOA dashboard counts the PIC, not the shared login.
    await soa.goto("/dashboard/soa");
    const workload = soa.getByRole("heading", { name: "Workload by assignee" }).locator("xpath=ancestor::*[@data-slot='card'][1]");
    await expect(workload).toContainText(`Ibnu ${id}`);

    // Deactivated, a PIC is no longer offered, but the request and its history keep the name.
    await admin.goto("/admin/pics");
    await expect(async () => {
      await soaCard.getByRole("button", { name: `Deactivate Adityo ${id}` }).click();
      await expect(soaCard.getByText("Deactivated.")).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30_000 });
    await soa.goto(`/request/${boq}`);
    await expect(soa.getByLabel("PIC").locator("option", { hasText: `Adityo ${id}` })).toHaveCount(0);
    await soa.getByText(/PIC history/).click();
    await expect(soa.getByRole("cell", { name: new RegExp(`Unassigned → Adityo ${id}`) })).toBeVisible();
    await expect(soa.getByRole("cell", { name: new RegExp(`Adityo ${id} → Ibnu ${id}`) })).toBeVisible();
    await soa.context().close();
    await admin.context().close();
  });

  test("only administrators open the PIC page; Sales, SOA and Purchasing do not", async ({ page, browser }) => {
    await signIn(page, "SALES");
    await expectNotFound(page, "/admin/pics", "Add PIC");
    const soa = await asRole(browser, "SOA");
    await expectNotFound(soa, "/admin/pics", "Add PIC");
    await soa.context().close();
    const purchasing = await asRole(browser, "PURCHASING");
    await expectNotFound(purchasing, "/admin/pics", "Add PIC");
    await purchasing.context().close();
  });
});

const HEADERS = ["End user", "Project", "Sales PIC", "Progress", "Status", "Estimated PO value", "Principals", "Industry"];

test.describe("importing projects from Excel, paging the table and drilling down from the charts", () => {
  test("SOA imports a sheet (duplicate and invalid rows are reported), the table pages 25, 50, 100 and All, and the Overview charts open the same projects", async ({ browser }) => {
    test.setTimeout(300_000);
    const id = tag();
    const salesEmail = seedEmailFor("SALES");
    // Each run is worth more than the one before (the value follows the clock), so its principal and industry stay among the largest
    // slices of the charts however many earlier runs the test database holds.
    const scale = Math.floor(Date.now() / 60_000);
    const row = (index: number, extra: Partial<Record<string, string | number>> = {}) => {
      const values: Record<string, string | number> = {
        "End user": `E2E Import ${id}`,
        Project: `Import job ${index} ${id}`,
        "Sales PIC": salesEmail,
        Progress: index % 2 === 0 ? "30% - Propose" : "Qualify",
        Status: "On Track",
        "Estimated PO value": scale * 1000 * (index + 1),
        Principals: `E2E Brand ${id}; E2E Second ${id}`,
        Industry: `E2E Industry ${id}`,
        ...extra,
      };
      return HEADERS.map((header) => values[header] ?? null);
    };
    const rows = [...Array.from({ length: 30 }, (_, index) => row(index)), row(0), row(99, { Progress: "maybe" })];
    const workbook = Buffer.from(toXlsx("Pipeline", HEADERS, rows));

    const soa = await asRole(browser, "SOA");
    await soa.goto("/projects");
    // The import is a modal on the Projects page, not a page of its own.
    await expect(async () => {
      await soa.getByRole("button", { name: "Import from Excel" }).click();
      await expect(soa.getByRole("dialog", { name: "Import projects" })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    await expect(soa).toHaveURL(/\/projects$/);

    // The template: a workbook with one column per field and the required ones marked.
    const [download] = await Promise.all([soa.waitForEvent("download"), soa.getByRole("link", { name: "Download template" }).click()]);
    expect(download.suggestedFilename()).toBe("halcom-projects-import-template.xlsx");
    const sheet = strFromU8(unzipSync(new Uint8Array(readFileSync((await download.path())!)))["xl/worksheets/sheet1.xml"]!);
    for (const header of ["End user *", "Project name *", "Sales PIC", "Estimated PO value", "Principals"]) expect(sheet).toContain(header);
    await soa.getByText("What each column holds").click();
    await expect(soa.getByRole("cell", { name: "External sales name" })).toBeVisible();

    // 1. Choose the file. A choice made before the page is interactive does nothing, so it is repeated.
    await expect(async () => {
      await soa.getByLabel("Excel workbook (.xlsx)").setInputFiles({ name: `e2e-${id}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook });
      await expect(soa.getByRole("heading", { name: "2. Match the columns" })).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 45_000 });
    await expect(soa.getByText(/32 rows of data, 8 columns/)).toBeVisible();
    // The columns were matched by name.
    await expect(soa.getByLabel("End user *")).toHaveValue("0");
    await expect(soa.getByLabel("Sales PIC")).toHaveValue("2");
    // A required field cannot be left without a column.
    await soa.getByLabel("Project name *").selectOption("");
    await expect(soa.getByRole("button", { name: "Check the sheet" })).toBeDisabled();
    await soa.getByLabel("Project name *").selectOption("1");

    // 2. Check: 30 ready, 1 duplicate, 1 problem, and nothing written yet.
    await soa.getByRole("button", { name: "Check the sheet" }).click();
    await expect(soa.getByText(/32 rows in .Pipeline.: 30 ready, 1 duplicate/)).toBeVisible();
    await expect(soa.getByRole("cell", { name: "Duplicate (skipped)" })).toBeVisible();
    await expect(soa.getByRole("cell", { name: /Progress "maybe"/ })).toBeVisible();
    await expect(soa.getByText(`principals: E2E Brand ${id}, E2E Second ${id}`)).toBeVisible();
    // All or nothing is the default, and it refuses while a row has a problem.
    await expect(soa.getByRole("button", { name: /^Import 30 projects/ })).toBeDisabled();
    await soa.getByLabel("Import the valid rows and skip the rows with problems").check();
    await soa.getByRole("button", { name: "Import 30 projects" }).click();
    await expect(soa.getByRole("heading", { name: "Import finished" })).toBeVisible({ timeout: 60_000 });
    await expect(soa.getByText(/30 projects created, 1 duplicate skipped, 1 row with problems skipped/)).toBeVisible();
    await soa.getByRole("button", { name: "Close and show the projects" }).click();
    await expect(soa.getByRole("dialog")).toHaveCount(0);

    // Paging: 25 by default, 50, 100 and All, with the filter kept.
    await soa.goto(`/projects?q=${encodeURIComponent(`E2E Import ${id}`)}`);
    await expect(soa.getByRole("status").filter({ hasText: "30 projects" })).toBeVisible();
    await expect(soa.getByText("Showing 1–25 of 30")).toBeVisible();
    await expect(soa.getByRole("link", { name: /^PRJ-\d+$/ })).toHaveCount(25);
    await soa.getByRole("link", { name: "Next" }).click();
    await expect(soa.getByText("Showing 26–30 of 30")).toBeVisible();
    await expect(soa.getByRole("link", { name: /^PRJ-\d+$/ })).toHaveCount(5);
    await soa.getByRole("group", { name: "Rows per page" }).getByRole("link", { name: "50" }).click();
    await expect(soa.getByText("Showing 1–30 of 30")).toBeVisible();
    await expect(soa.getByRole("group", { name: "Rows per page" }).getByRole("link", { name: "50" })).toHaveAttribute("aria-current", "true");
    await soa.getByRole("group", { name: "Rows per page" }).getByRole("link", { name: "100" }).click();
    await expect(soa.getByText("Showing 1–30 of 30")).toBeVisible();
    await soa.getByRole("group", { name: "Rows per page" }).getByRole("link", { name: "All" }).click();
    await expect(soa).toHaveURL(/per=all/);
    await expect(soa.getByRole("link", { name: /^PRJ-\d+$/ })).toHaveCount(30);
    await expect(soa.getByText("Showing 1–30 of 30")).toBeVisible();
    await expect(soa.getByRole("group", { name: "Rows per page" }).getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");
    // Searching again from All keeps All; the numbers follow the filter.
    await soa.getByLabel("Search projects").fill(`job 7 ${id}`);
    await soa.getByRole("button", { name: "Filter" }).click();
    await expect(soa).toHaveURL(/per=all/);
    await expect(soa.getByRole("status").filter({ hasText: "1 project" })).toBeVisible();

    // The same projects, from the Overview charts. Each chart opens the list with the count it showed.
    await soa.goto("/dashboard");
    const industry = soa.getByRole("link", { name: new RegExp(`^E2E Industry ${id}: .*Show the projects`) }).first();
    await expect(industry).toBeVisible();
    await industry.click();
    await expect(soa).toHaveURL(new RegExp(`industry=e2e\\+industry\\+${id}`));
    await expect(soa.getByRole("status").filter({ hasText: "30 projects" })).toBeVisible();

    await soa.goto("/dashboard");
    const brand = soa.getByRole("link", { name: new RegExp(`^E2E Brand ${id}: .*Show the projects`) }).first();
    await brand.click();
    await expect(soa).toHaveURL(/principal=/);
    await expect(soa.getByRole("status").filter({ hasText: "30 projects" })).toBeVisible();
    // A project with two principals is in each of their slices.
    await soa.goto("/dashboard");
    await soa.getByRole("link", { name: new RegExp(`^E2E Second ${id}: .*Show the projects`) }).first().click();
    await expect(soa.getByRole("status").filter({ hasText: "30 projects" })).toBeVisible();

    // The funnel and the progress columns: the number on the chart is the number in the list.
    for (const step of ["Qualify", "Propose"]) {
      // Other tests may add a project between reading the chart and opening the list, so the pair is read again if they differ.
      await expect(async () => {
        await soa.goto("/dashboard");
        const link = soa.getByRole("link", { name: new RegExp(`^${step}: \\d+ projects?, .*Show the projects`) }).first();
        const count = Number(/: (\d+) project/.exec((await link.getAttribute("aria-label"))!)![1]);
        await link.click();
        await expect(soa).toHaveURL(/reached=/);
        await expect(soa.getByRole("status").filter({ hasText: new RegExp(`^${count} projects? `) })).toBeVisible({ timeout: 4000 });
      }).toPass({ timeout: 40_000 });
    }
    await soa.context().close();
  });

  test("a file dropped on the drop zone is read like a chosen one, and a file that is not .xlsx is refused", async ({ browser }) => {
    test.setTimeout(120_000);
    const workbook = Buffer.from(toXlsx("Pipeline", HEADERS, [["PT Drop", "Dropped job", "sales@example.invalid", null, null, null, null, null]]));
    const soa = await asRole(browser, "SOA");
    await soa.goto("/projects");
    await soa.getByRole("button", { name: "Import from Excel" }).click();
    await expect(soa.getByText("Drag the .xlsx file here, or click to choose it")).toBeVisible();
    // The zone is the label of the file input; its text changes to the file name once a file was dropped.
    const zone = soa.locator('label[for="import-file"]');

    const drop = async (name: string, bytes: number[], type: string) => {
      const data = await soa.evaluateHandle(
        ({ name, bytes, type }) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([new Uint8Array(bytes)], name, { type }));
          return transfer;
        },
        { name, bytes, type },
      );
      await zone.dispatchEvent("drop", { dataTransfer: data });
    };
    await expect(async () => {
      await drop("notes.txt", [104, 105], "text/plain");
      await expect(soa.getByRole("dialog").getByRole("alert")).toContainText("Only .xlsx workbooks can be imported", { timeout: 12_000 });
    }).toPass({ timeout: 30_000 });
    await expect(async () => {
      await drop("dropped.xlsx", [...workbook], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      await expect(soa.getByRole("heading", { name: "2. Match the columns" })).toBeVisible({ timeout: 12_000 });
    }).toPass({ timeout: 30_000 });
    await expect(soa.getByText(/dropped.xlsx: sheet .Pipeline., 1 row of data/)).toBeVisible();
    await soa.getByRole("button", { name: "Close", exact: true }).click();
    await soa.context().close();
  });

  test("a salesperson's drill-down keeps to their own projects", async ({ browser }) => {
    test.setTimeout(120_000);
    const sales = await asRole(browser, "SALES");
    await sales.goto("/dashboard/sales?view=charts");
    const funnel = sales.getByRole("link", { name: /^Qualify: \d+ projects?, .*Show the projects/ }).first();
    await expect(funnel).toBeVisible();
    const count = Number(/: (\d+) project/.exec((await funnel.getAttribute("aria-label"))!)![1]);
    await funnel.click();
    await expect(sales).toHaveURL(/reached=QUALIFY.*mine=1|mine=1.*reached=QUALIFY/);
    await expect(sales.getByRole("status").filter({ hasText: new RegExp(`^${count} projects? `) })).toBeVisible();
    await sales.context().close();
  });
});
