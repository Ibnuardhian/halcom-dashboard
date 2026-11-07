import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Management see what needs attention, a section per team, and what is stuck between teams", async ({ page }) => {
  await signIn(page, "MANAGEMENT");
  await page.goto("/dashboard/management");
  await expect(page.getByRole("heading", { level: 1, name: "Management dashboard" })).toBeVisible();

  // The ranked concerns come first, with the count per level in words.
  await expect(page.getByRole("region", { name: "Perlu perhatian" })).toBeVisible();
  const levels = page.getByRole("list", { name: "Jumlah per tingkat" });
  for (const level of ["Danger", "Warning", "Info"]) await expect(levels).toContainText(level);

  // One block per team and one for what sits between them; each tile links to the list behind it.
  const soa = page.getByTestId("section-team-soa");
  const purchasing = page.getByTestId("section-team-purchasing");
  await expect(soa).toBeVisible();
  await expect(purchasing).toBeVisible();
  await expect(soa.getByRole("link", { name: /^Overdue/ })).toHaveAttribute("href", "/requests/boq?sla=overdue");
  await expect(purchasing.getByRole("link", { name: /^Overdue/ })).toHaveAttribute("href", "/requests?types=RFQ,PO&sla=overdue");
  await expect(soa.getByRole("heading", { name: "Bottleneck per status" })).toBeVisible();
  await expect(soa.getByRole("heading", { name: "Beban per PIC" })).toBeVisible();
  await expect(soa.getByRole("heading", { name: "Enam bulan terakhir" })).toBeVisible();
  await expect(page.getByTestId("section-between-teams")).toBeVisible();

  // It only reads: no button changes anything here.
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
});

test("a salesperson cannot open the Management dashboard", async ({ page }) => {
  await signIn(page, "SALES");
  await page.goto("/dashboard/management");
  await expect(page.getByText("Halaman tidak ditemukan")).toBeVisible();
});
