import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Sales change the description of their project, Admin may too, and SOA only read it", async ({ browser }) => {
  test.setTimeout(240_000);
  const as = async (role: Parameters<typeof signIn>[1]) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, role);
    return page;
  };
  const sales = await as("SALES");
  await sales.goto("/projects/new");
  await expect(async () => {
    await sales.getByLabel("End-user company").fill("E2E Description Co");
    await sales.getByLabel("Project name").fill(`Description job ${Date.now()}`);
    await sales.getByRole("button", { name: "Create project" }).click();
    await expect(sales).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const path = new URL(sales.url()).pathname;

  const text = `Scope of work ${Date.now()}`;
  await expect(async () => {
    await sales.locator("textarea[id^=description-HIT]").fill(text);
    await sales.getByRole("button", { name: "Simpan deskripsi" }).click();
    await expect(sales.getByText("Deskripsi disimpan dan dicatat di change log.")).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 45_000 });
  await sales.reload();
  await expect(sales.locator("textarea[id^=description-HIT]")).toHaveValue(text);
  await sales.context().close();

  const admin = await as("ADMIN");
  await admin.goto(path);
  await expect(admin.locator("textarea[id^=description-HIT]")).toHaveValue(text);
  await admin.context().close();

  const soa = await as("SOA");
  await soa.goto(path);
  await expect(soa.getByText(text).first()).toBeVisible();
  await expect(soa.getByRole("button", { name: "Simpan deskripsi" })).toHaveCount(0);
  await soa.context().close();
});
