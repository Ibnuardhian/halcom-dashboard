import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the project page shows Commercial, Technical, Activity and Requests as tabs that change only on a click", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "SALES");
  await page.goto("/projects");
  await page.getByRole("link", { name: /^HIT-PROJ-\d+$/ }).first().click();
  await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+$/);

  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  const panel = (id: string) => page.locator(`#panel-${id}`);

  // Sales open on Commercial; the others stay hidden but in the page.
  await expect(tab("Commercial")).toHaveAttribute("aria-selected", "true");
  await expect(panel("commercial")).toBeVisible();
  await expect(panel("requests")).toBeHidden();

  await expect(async () => {
    await tab("Requests").click();
    await expect(panel("requests")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(panel("commercial")).toBeHidden();

  // An address into a tab opens it; the arrow keys move between tabs.
  await page.goto(`${page.url().split("#")[0]}#technical`);
  await expect(tab("Technical")).toHaveAttribute("aria-selected", "true");
  await tab("Technical").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab("Activity")).toHaveAttribute("aria-selected", "true");
});
