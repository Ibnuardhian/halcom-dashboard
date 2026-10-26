import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the Projects table shows the last update instead of Estimated and Target closing, sorted by it by default", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "SALES");
  await page.goto("/projects");
  const heads = page.getByRole("columnheader");
  await expect(heads.filter({ hasText: "Last updated" })).toBeVisible();
  await expect(heads.filter({ hasText: "Estimated" })).toHaveCount(0);
  await expect(heads.filter({ hasText: "Target closing" })).toHaveCount(0);
  // With no column chosen the newest update comes first, so its heading carries the descending mark.
  await expect(heads.filter({ hasText: "Last updated" })).toHaveAttribute("aria-sort", "descending");
  // One click turns it around (a link, so the whole list is sorted and not only the rows on screen).
  await heads.filter({ hasText: "Last updated" }).getByRole("link").click();
  await expect(page).toHaveURL(/dir=asc/);
  await expect(heads.filter({ hasText: "Last updated" })).toHaveAttribute("aria-sort", "ascending");
});
