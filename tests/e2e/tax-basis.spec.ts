import { expect, test } from "@playwright/test";
import { expectNotFound, signIn } from "./helpers";

test("a superadmin sets whether the value and the margin include PPN; the project page says which", async ({ browser }) => {
  test.setTimeout(240_000);
  const sales = await (await browser.newContext()).newPage();
  await signIn(sales, "SALES");
  await sales.goto("/projects/new");
  await expect(async () => {
    await sales.getByLabel("End-user company").fill("E2E Tax Co");
    await sales.getByLabel("Project name").fill(`Tax job ${Date.now()}`);
    await sales.getByRole("button", { name: "Create project" }).click();
    await expect(sales).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const path = new URL(sales.url()).pathname;
  // Sales and Admin cannot change the setting.
  await expectNotFound(sales, "/admin/settings/ppn", "Basis PPN");
  await sales.goto(path);
  await expect(sales.getByText("Final value (incl. PPN)")).toBeVisible();
  await expect(sales.getByText("Gross Profit (excl. PPN)")).toBeVisible();

  const root = await (await browser.newContext()).newPage();
  await signIn(root, "SUPERADMIN");
  const choose = async (valueBasis: string, marginBasis: string, message: RegExp) => {
    await root.goto("/admin/settings/ppn");
    await expect(async () => {
      await root.getByLabel("Estimated PO value dan Final value").selectOption(valueBasis);
      await root.getByLabel("Gross Profit").selectOption(marginBasis);
      await root.getByRole("button", { name: "Save PPN basis" }).click();
      await expect(root.getByText(message)).toBeVisible({ timeout: 8000 });
    }).toPass({ timeout: 45_000 });
  };
  await choose("0", "0", /Tersimpan\.|Tidak ada perubahan\./);
  await sales.reload();
  await expect(sales.getByText("Final value (excl. PPN)")).toBeVisible();
  await expect(sales.getByText("Gross Profit (excl. PPN)")).toBeVisible();

  // Back to the default: value with PPN, margin without.
  await choose("1", "0", /Tersimpan\.|Tidak ada perubahan\./);
  await sales.reload();
  await expect(sales.getByText("Final value (incl. PPN)")).toBeVisible();
  await root.context().close();
  await sales.context().close();
});
