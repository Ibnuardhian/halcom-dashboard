import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("a date field has a calendar button, and the day picked there is written as DD/MM/YYYY", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "SALES");
  await page.goto("/projects/new");
  const box = page.getByLabel("Target closing", { exact: true });
  await expect(page.getByRole("button", { name: "Pilih tanggal Target closing" })).toBeVisible();

  // The calendar itself is the browser's; the day it hands back is what the box shows.
  await expect(async () => {
    await box.fill("");
    await page.locator('div:has(> input#project-target) > input[type="date"]').evaluate((input) => {
      const element = input as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(element, "2026-09-01");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(box).toHaveValue("01/09/2026", { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
});
