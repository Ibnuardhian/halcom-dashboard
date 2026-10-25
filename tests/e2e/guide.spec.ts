import { expect, test, type Page } from "@playwright/test";
import { ROLES, type Role } from "@/domain/access/roles";
import { signIn } from "./helpers";

const ACTIVE_LANES: Record<Role, Role[]> = {
  SUPERADMIN: ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT", "ADMIN", "SUPERADMIN"],
  ADMIN: ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT", "ADMIN"],
  SALES: ["SALES"],
  SOA: ["SOA"],
  PURCHASING: ["PURCHASING"],
  FINANCE: ["FINANCE"],
  MANAGEMENT: ["MANAGEMENT"],
};

async function openGuide(page: Page, role: Role) {
  await signIn(page, role);
  // A click before the page is interactive does nothing, so it is repeated until the guide opens.
  await expect(async () => {
    await page.getByRole("link", { name: "User Guide" }).click();
    await expect(page).toHaveURL(/\/guide$/, { timeout: 5_000 });
  }).toPass({ timeout: 40_000 });
  await expect(page.getByRole("heading", { level: 1, name: "User Guide" })).toBeVisible();
}

const node = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const lane = (page: Page, role: Role) => page.getByTestId(`guide-lane-${role}`);

test.describe("the guide opens for every role and highlights that role", () => {
  for (const role of ROLES) {
    test(`${role}: reachable from the header, legend shown, lanes highlighted from permissions`, async ({ page }) => {
      await openGuide(page, role);

      await expect(page.getByTestId("guide-legend")).toBeVisible();
      for (const laneRole of ROLES) {
        await expect(lane(page, laneRole), `${role} sees lane ${laneRole}`).toHaveAttribute("data-active", ACTIVE_LANES[role].includes(laneRole) ? "true" : "false");
      }
      // The highlighted nodes carry a written tag, so the highlight never depends on colour alone.
      const own = lane(page, role);
      await expect(own).toContainText("Your role");
      await expect(page.getByRole("tab", { name: /Your role|You/ }).first()).toBeVisible();
    });
  }
});

test.describe("flowchart interaction", () => {
  test("hover shows the details, leaving hides them, click pins them and Escape closes", async ({ page }) => {
    await openGuide(page, "SOA");
    const receive = node(page, "soa.receive");
    const card = page.getByTestId("guide-card");

    await receive.hover();
    await expect(card).toBeVisible();
    for (const label of ["Action", "Required input", "Output", "Next recipient"]) await expect(card.getByText(label, { exact: true })).toBeVisible();
    await expect(card).toContainText("SOA");
    await expect(card).toContainText("Terima dan triase BOQ");

    await page.getByTestId("guide-chart").hover({ position: { x: 5, y: 5 } });
    await expect(card).toBeHidden();

    await receive.click();
    await expect(receive).toHaveAttribute("aria-expanded", "true");
    await page.mouse.move(2, 2);
    await expect(card).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(receive).toHaveAttribute("aria-expanded", "false");
  });

  test("the details of a step at the far end of the chart stay on screen", async ({ page }) => {
    await openGuide(page, "PURCHASING");
    const card = page.getByTestId("guide-card");
    for (const id of ["pur.po", "super.config", "sales.track"]) {
      await node(page, id).hover();
      await expect(card).toBeVisible();
      const box = (await card.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.y, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height, id).toBeLessThanOrEqual(viewport.height);
    }
  });

  test("a click on empty chart or on the close button dismisses a pinned card, and a second click on the node does too", async ({ page }) => {
    await openGuide(page, "SALES");
    const card = page.getByTestId("guide-card");
    const create = node(page, "sales.create");

    await create.click();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Close details" }).click();
    await expect(card).toBeHidden();

    await create.click();
    await expect(card).toBeVisible();
    await page.mouse.move(2, 2);
    await create.click();
    await expect(create).toHaveAttribute("aria-expanded", "false");
    await expect(card).toBeHidden();
  });

  test("keyboard: focus shows the details, Enter pins them, Escape closes them and keeps focus on the step", async ({ page }) => {
    await openGuide(page, "PURCHASING");
    const quote = node(page, "pur.quote");
    const card = page.getByTestId("guide-card");

    await quote.focus();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Perbarui progres quotation");

    await page.keyboard.press("Enter");
    await expect(quote).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(quote).toBeFocused();

    // Tab moves on to the next step in the flow order.
    await quote.focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-guide-node]:focus")).toHaveCount(1);
  });

  test("dragging the chart stops when the mouse button is released, also outside the chart", async ({ page }) => {
    await openGuide(page, "FINANCE");
    const chart = page.getByTestId("guide-chart");
    const box = (await chart.boundingBox())!;
    const startX = box.x + box.width - 40;
    const y = box.y + 20;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - 200, y, { steps: 5 });
    const dragged = await chart.evaluate((el) => el.scrollLeft);
    expect(dragged).toBeGreaterThan(0);

    // Let go well outside the chart, then wander: the chart must stay where it is.
    await page.mouse.move(box.x + box.width + 150, y + 20, { steps: 3 });
    await page.mouse.up();
    const released = await chart.evaluate((el) => el.scrollLeft);
    await page.mouse.move(box.x + 30, y + 40, { steps: 8 });
    await page.mouse.move(box.x + box.width + 100, y - 10, { steps: 8 });
    expect(await chart.evaluate((el) => el.scrollLeft)).toBe(released);
  });

  test("zoom buttons change the scale and the frame can be scrolled", async ({ page }) => {
    await openGuide(page, "FINANCE");
    const chart = page.getByTestId("guide-chart");

    await expect(page.getByText("100%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByText("115%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(page.getByText("90%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset zoom to 100%" }).click();
    await expect(page.getByText("100%", { exact: true })).toBeVisible();

    expect(await chart.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await chart.evaluate((el) => el.scrollTo({ left: 400 }));
    expect(await chart.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });
});

test.describe("role-by-role steps", () => {
  test("opens on the signed-in role, switches with the arrow keys, and shows only links the role may use", async ({ page }) => {
    await openGuide(page, "SALES");
    const salesTab = page.getByRole("tab", { name: /^Sales/ });
    await expect(salesTab).toHaveAttribute("aria-selected", "true");

    const panel = page.getByRole("tabpanel");
    await expect(panel).toContainText("Buat proyek");
    await expect(panel.getByRole("link", { name: "New project" })).toBeVisible();
    for (const heading of ["Can read", "Can edit", "Cannot"]) await expect(panel.getByRole("heading", { name: heading, exact: true })).toBeVisible();

    await salesTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: /^SOA/ })).toHaveAttribute("aria-selected", "true");
    await expect(panel).toContainText("Terima dan triase BOQ");
    // Sales may not open Purchasing Handoff, so the SOA step offers no link to it.
    await expect(panel.getByRole("link", { name: "Purchasing Handoff" })).toHaveCount(0);
  });

  test("an SOA account gets the Purchasing Handoff link, and Finance gets the crosscheck link", async ({ page }) => {
    await openGuide(page, "SOA");
    await page.getByRole("tab", { name: /^SOA/ }).click();
    await expect(page.getByRole("tabpanel").getByRole("link", { name: "Purchasing Handoff" })).toBeVisible();

    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await openGuide(page, "FINANCE");
    await expect(page.getByRole("tabpanel").getByRole("link", { name: "Financial Crosscheck" })).toBeVisible();
  });

  test("the administrators' instructions are shown only to people who hold those roles", async ({ page }) => {
    await openGuide(page, "SALES");
    await page.getByRole("tab", { name: /^Admin/ }).click();
    await expect(page.getByRole("tabpanel")).toContainText("hanya ditampilkan kepada yang memegang peran tersebut");
    await expect(page.getByRole("tabpanel")).not.toContainText("Buka Users and Roles");
    expect(await page.content()).not.toContain("Buka Permissions untuk memberi atau mencabut");

    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await openGuide(page, "ADMIN");
    await page.getByRole("tab", { name: /^Admin/ }).click();
    await expect(page.getByRole("tabpanel")).toContainText("Buka Users and Roles");
    await page.getByRole("tab", { name: /^Superadmin/ }).click();
    await expect(page.getByRole("tabpanel")).toContainText("hanya ditampilkan kepada yang memegang peran tersebut");
  });
});

test.describe("small screens", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the steps as a list instead of the chart, without sideways scrolling of the page", async ({ page }) => {
    await signIn(page, "SOA");
    await page.goto("/guide");
    await expect(page.getByRole("heading", { level: 1, name: "User Guide" })).toBeVisible();

    await expect(page.getByTestId("guide-chart")).toBeHidden();
    const list = page.getByTestId("guide-list");
    await expect(list).toBeVisible();
    const first = list.locator("details").first();
    await first.locator("summary").click();
    await expect(first).toContainText("Next recipient");

    // SOA's steps are marked in text.
    await expect(list.locator('details[data-active="true"]').first()).toContainText("Your role");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The role tabs scroll inside their own strip.
    await expect(page.getByRole("tab", { name: /^SOA/ })).toHaveAttribute("aria-selected", "true");
  });
});

test("a visitor who is signed out is sent to the login page", async ({ page }) => {
  await page.goto("/guide");
  await expect(page).toHaveURL(/\/login$/);
});

test("screenshot of the guide for review", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openGuide(page, "SOA");
  await node(page, "soa.handoff").hover();
  await expect(page.getByTestId("guide-card")).toBeVisible();
  await page.screenshot({ path: "test-results/guide-soa.png", fullPage: false });
  await page.getByRole("button", { name: "Fit chart to width" }).click();
  await page.mouse.move(2, 2);
  await page.getByTestId("guide-chart").screenshot({ path: "test-results/guide-soa-fit.png" });
});
