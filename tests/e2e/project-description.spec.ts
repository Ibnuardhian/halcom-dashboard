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
    if (!(await sales.getByRole("dialog").isVisible())) await sales.getByRole("button", { name: "Edit nama dan description" }).click(); // the form opens in a modal
    await sales.locator("textarea[id^=description-HIT]").fill(text);
    await sales.getByRole("button", { name: "Save name and description" }).click();
    await expect(sales.getByText("Tersimpan dan dicatat di change log: deskripsi.")).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 45_000 });
  await sales.reload();
  await expect(sales.locator("p", { hasText: text }).first()).toBeVisible(); // shown as text, saved
  await expect(sales.locator("textarea[id^=description-HIT]")).toBeHidden(); // the form is closed until Edit is pressed
  await sales.context().close();

  const admin = await as("ADMIN");
  await admin.goto(path);
  await expect(admin.locator("p", { hasText: text }).first()).toBeVisible();
  await expect(admin.getByRole("button", { name: "Edit nama dan description" })).toBeVisible();
  await admin.context().close();

  const soa = await as("SOA");
  await soa.goto(path);
  await expect(soa.locator("p", { hasText: text }).first()).toBeVisible();
  // SOA may rename, so it has the Edit button, but the modal holds only the name: the description is not theirs to change.
  await soa.getByRole("button", { name: "Edit nama dan description" }).click();
  await expect(soa.getByLabel("Nama project", { exact: true })).toBeVisible();
  await expect(soa.locator("textarea[id^=description-HIT]")).toHaveCount(0);
  await soa.context().close();
});
