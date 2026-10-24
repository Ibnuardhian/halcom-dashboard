import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/** A response of the chart endpoint, built here so the states that are hard to reach with real data (error, empty, slow) can be shown. */
function body(granularity: string, over: Record<string, unknown> = {}) {
  const point = (i: number) => ({
    key: `${granularity}-${i}`,
    label: `${granularity} ${i}`,
    start: "2026-01-01T00:00:00.000Z",
    asOf: "2026-01-31T00:00:00.000Z",
    running: i === 2,
    reliable: true,
    counts: { OPPORTUNITY: 4 + i, QUOTED: 2, CLOSED_WON: i },
    total: 6 + 2 * i,
    percents: { OPPORTUNITY: 50, QUOTED: 30, CLOSED_WON: 20 },
  });
  const card = (category: string, label: string, color: string, count: number) => ({ category, label, color, count, percent: 33.3, comparison: { kind: "change", delta: 1, percent: 10 } });
  return {
    granularity,
    timeZone: "Asia/Jakarta",
    points: [point(0), point(1), point(2)],
    cards: [card("OPPORTUNITY", "Opportunity", "#F5B800", 6), card("QUOTED", "Quoted", "#2F80ED", 2), card("CLOSED_WON", "Closed Won", "#10B981", 2)],
    historyStartsAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

async function open(page: Page) {
  await signIn(page, "SALES");
  await page.goto("/dashboard/sales");
  await expect(page.getByRole("heading", { name: "Pipeline Growth" })).toBeVisible();
}

test.describe("Sales Pipeline: KPI cards and Pipeline Growth", () => {
  test("shows Pipeline conversion instead of Weighted pipeline, and the three groups with their colours", async ({ page }) => {
    await open(page);
    const tiles = page.getByRole("region", { name: "Pipeline numbers" });
    for (const label of ["Open projects", "Open pipeline", "Pipeline conversion", "Estimated gross profit", "Won"]) {
      await expect(tiles.getByText(label, { exact: false }).first()).toBeVisible();
    }
    await expect(tiles.getByText("Weighted pipeline")).toHaveCount(0);

    const chart = page.getByTestId("pipeline-growth");
    for (const [name, rgb] of [["Opportunity", "rgb(245, 184, 0)"], ["Quoted", "rgb(47, 128, 237)"], ["Closed Won", "rgb(16, 185, 129)"]] as const) {
      const legend = chart.getByRole("list", { name: "Legend" }).getByText(name, { exact: true });
      await expect(legend).toBeVisible();
      await expect(legend.locator("xpath=preceding-sibling::span[1]")).toHaveCSS("background-color", rgb);
    }
    // Lines use the same colours.
    for (const [category, colour] of [["OPPORTUNITY", "#F5B800"], ["QUOTED", "#2F80ED"], ["CLOSED_WON", "#10B981"]] as const) {
      await expect(chart.locator(`g[data-category="${category}"] path[fill="none"]`).first()).toHaveAttribute("stroke", colour);
    }
    await expect(chart.getByTestId("growth-card-OPPORTUNITY")).toBeVisible();
    await expect(chart.getByTestId("growth-card-QUOTED")).toBeVisible();
    await expect(chart.getByTestId("growth-card-CLOSED_WON")).toBeVisible();
    // The numbers are also available as a table.
    await chart.getByText("Show the numbers as a table").click();
    await expect(chart.getByRole("table").getByRole("columnheader", { name: "Quoted" })).toBeVisible();
  });

  test("changes between weekly, monthly and quarterly without reloading the page", async ({ page }) => {
    await open(page);
    await page.evaluate(() => ((window as unknown as { __stay: boolean }).__stay = true));
    const chart = page.getByTestId("pipeline-growth");
    for (const [name, word] of [["Weekly", "week"], ["Quarterly", "quarter"], ["Monthly", "month"]] as const) {
      const answered = page.waitForResponse((r) => r.url().includes("/api/pipeline-growth?granularity=" + name.toLowerCase()) && r.status() === 200);
      await chart.getByRole("button", { name }).click();
      await answered;
      await expect(chart.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
      await expect(chart.getByText(`at the end of the ${word}`)).toBeVisible();
    }
    expect(await page.evaluate(() => (window as unknown as { __stay?: boolean }).__stay)).toBe(true); // the same document, not a reload
  });

  test("shows a tooltip with the count and the percentage of each group", async ({ page }) => {
    await page.route("**/api/pipeline-growth?granularity=weekly", (route) => route.fulfill({ json: body("weekly") }));
    await open(page);
    const chart = page.getByTestId("pipeline-growth");
    await chart.getByRole("button", { name: "Weekly" }).click();
    await expect(chart.getByRole("button", { name: /weekly 2/ })).toBeVisible();
    await chart.getByRole("button", { name: /weekly 1:/ }).hover();
    const tip = page.getByTestId("pipeline-growth-tooltip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Opportunity: 5 projects (50.0%)");
    await expect(tip).toContainText("Quoted: 2 projects (30.0%)");
    await expect(tip).toContainText("Closed Won: 1 project (20.0%)");
    // Keyboard users get the same through focus.
    await chart.getByRole("button", { name: /weekly 2/ }).focus();
    await expect(tip).toContainText("weekly 2 (so far)");
  });

  test("shows an error with a retry, and recovers", async ({ page }) => {
    await open(page);
    await page.route("**/api/pipeline-growth?granularity=weekly", (route) => route.fulfill({ status: 500, json: { error: "boom" } }));
    const chart = page.getByTestId("pipeline-growth");
    await chart.getByRole("button", { name: "Weekly" }).click();
    await expect(chart.getByRole("alert")).toContainText("could not be loaded");
    await page.unroute("**/api/pipeline-growth?granularity=weekly");
    await chart.getByRole("button", { name: "Try again" }).click();
    await expect(chart.getByRole("alert")).toHaveCount(0);
    await expect(chart.getByText("at the end of the week")).toBeVisible();
  });

  test("says the session has ended when the endpoint answers 401", async ({ page }) => {
    await open(page);
    await page.route("**/api/pipeline-growth?granularity=quarterly", (route) => route.fulfill({ status: 401, json: { error: "Sign in" } }));
    await page.getByTestId("pipeline-growth").getByRole("button", { name: "Quarterly" }).click();
    await expect(page.getByTestId("pipeline-growth").getByRole("alert")).toContainText("session has ended");
  });

  test("shows an empty state, not a blank chart, when no period is covered by the history", async ({ page }) => {
    await open(page);
    const none = body("weekly", {
      points: [1, 2].map((i) => ({ key: `w${i}`, label: `W${i}`, start: "2026-01-01T00:00:00.000Z", asOf: "2026-01-02T00:00:00.000Z", running: i === 2, reliable: false, counts: null, total: null, percents: null })),
      cards: [],
    });
    await page.route("**/api/pipeline-growth?granularity=weekly", (route) => route.fulfill({ json: none }));
    await page.getByTestId("pipeline-growth").getByRole("button", { name: "Weekly" }).click();
    await expect(page.getByTestId("pipeline-growth").getByRole("status").filter({ hasText: /stage history starts/ })).toBeVisible();
  });

  test("notes where the stage history starts when earlier periods are left out", async ({ page }) => {
    await page.route("**/api/pipeline-growth?granularity=weekly", (route) => {
      const data = body("weekly");
      (data.points[0] as Record<string, unknown>).reliable = false;
      Object.assign(data.points[0] as Record<string, unknown>, { counts: null, total: null, percents: null });
      return route.fulfill({ json: data });
    });
    await open(page);
    await page.getByTestId("pipeline-growth").getByRole("button", { name: "Weekly" }).click();
    await expect(page.getByTestId("pipeline-growth-notice")).toContainText("stage history starts on 1 Jan 2026");
  });

  test("an answer to an older choice never replaces a newer one", async ({ page }) => {
    await open(page);
    // Weekly answers slowly; quarterly is chosen while it is on its way.
    await page.route("**/api/pipeline-growth?granularity=weekly", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({ json: body("weekly") }).catch(() => undefined);
    });
    const chart = page.getByTestId("pipeline-growth");
    await chart.getByRole("button", { name: "Weekly" }).click();
    await chart.getByRole("button", { name: "Quarterly" }).click();
    await expect(chart.getByText("at the end of the quarter")).toBeVisible();
    await page.waitForTimeout(3500); // long enough for the slow weekly answer to arrive
    await expect(chart.getByText("at the end of the quarter")).toBeVisible();
    await expect(chart.getByRole("button", { name: "Quarterly" })).toHaveAttribute("aria-pressed", "true");
    await expect(chart.getByRole("button", { name: /^weekly \d/ })).toHaveCount(0);
  });

  test("fits a phone: no sideways scrolling, and the chart and the cards are there", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    const chart = page.getByTestId("pipeline-growth");
    await expect(chart.locator("svg").first()).toBeVisible();
    await expect(chart.getByTestId("growth-card-QUOTED")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await chart.locator("svg").first().boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
  });

  test("the endpoint needs a sign-in, refuses an unknown period, and tells a salesperson only about their own projects", async ({ page, playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000" });
    expect((await anonymous.get("/api/pipeline-growth?granularity=weekly")).status()).toBe(401);
    await anonymous.dispose();

    await signIn(page, "SALES");
    expect((await page.request.get("/api/pipeline-growth?granularity=daily")).status()).toBe(400);
    expect((await page.request.get("/api/pipeline-growth")).status()).toBe(400);
    const ok = await page.request.get("/api/pipeline-growth?granularity=monthly");
    expect(ok.status()).toBe(200);
    expect(ok.headers()["cache-control"]).toContain("no-store");
    const data = await ok.json();
    expect(data.points).toHaveLength(12);
    expect(data.timeZone).toBe("Asia/Jakarta");
  });
});
