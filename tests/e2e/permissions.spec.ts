import { expect, test, type Browser, type Page } from "@playwright/test";
import { PERMISSION_CATEGORIES } from "@/domain/access/permission-catalog";
import { ALL_PERMISSIONS } from "@/domain/access/permissions";
import { expectNotFound, signIn } from "./helpers";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function asRole(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

async function openEditor(page: Page): Promise<void> {
  await page.goto("/admin/permissions");
  await expect(page.getByRole("heading", { level: 1, name: "Permissions" })).toBeVisible();
  // The form posts only once React has hydrated it.
  await expect(page.getByRole("button", { name: "Expand all" })).toBeEnabled();
  await page.getByRole("button", { name: "Expand all" }).click();
}

// The tests that change a role's permissions run one after another and put everything back before they end.
test.describe.configure({ mode: "serial" });

test.describe("admin dashboard", () => {
  test("admin and superadmin share one Admin dashboard; the superadmin-only tools appear only for the one who holds them", async ({ browser }) => {
    const admin = await asRole(browser, "ADMIN");
    const superadmin = await asRole(browser, "SUPERADMIN");

    await admin.goto("/dashboard/admin");
    await superadmin.goto("/dashboard/superadmin");
    for (const page of [admin, superadmin]) {
      await expect(page.getByRole("heading", { level: 1, name: "Admin dashboard" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Accounts" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Recent administrative activity" })).toBeVisible();
      // One entry in the menu, whichever address the role has.
      await expect(nav(page).getByRole("link", { name: /Admin dashboard/i })).toHaveCount(1);
    }
    const tools = (page: Page) => page.getByRole("list", { name: "Administration tools" });
    await expect(tools(superadmin).getByRole("link", { name: "System health" })).toBeVisible();
    await expect(tools(superadmin).getByRole("link", { name: "Backups" })).toBeVisible();
    await expect(tools(admin).getByRole("link", { name: "Role permissions" })).toBeVisible();
    await expect(tools(admin).getByRole("link", { name: "System health" })).toHaveCount(0);
    await expect(tools(admin).getByRole("link", { name: "Backups" })).toHaveCount(0);

    // The dashboard permissions stay separate: an admin still cannot open the superadmin address.
    await expectNotFound(admin, "/dashboard/superadmin", "Administration tools");
  });
});

test.describe("permission editor", () => {
  test("lists every permission once, in ten collapsible categories", async ({ page }) => {
    await signIn(page, "SUPERADMIN");
    await openEditor(page);

    await expect(page.locator("details[data-category]")).toHaveCount(PERMISSION_CATEGORIES.length);
    for (const [index, category] of PERMISSION_CATEGORIES.entries()) {
      await expect(page.locator("details[data-category] > summary").nth(index)).toContainText(category.title);
    }
    for (const permission of ALL_PERMISSIONS) await expect(page.locator("code", { hasText: new RegExp(`^${permission.replaceAll(".", "\\.")}$`) })).toHaveCount(1);

    // A category collapses and expands again.
    const first = page.locator("details[data-category]").first();
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(first).not.toHaveAttribute("open", "");
    await first.locator("summary").click();
    await expect(first).toHaveAttribute("open", "");
  });

  test("an admin sees the matrix without any way to change it", async ({ page }) => {
    await signIn(page, "ADMIN");
    await openEditor(page);

    await expect(page.getByText("Only a superadmin can change these.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save permissions" })).toHaveCount(0);
    await expect(page.locator("input[type=checkbox]")).toHaveCount(0);
    await expect(page.getByRole("row", { name: /finance\.crosscheck\.view/ })).toBeVisible();
  });

  test("the permissions that keep the superadmin in control cannot be switched off", async ({ page }) => {
    await signIn(page, "SUPERADMIN");
    await openEditor(page);

    await expect(page.getByRole("checkbox", { name: "Manage permissions for Superadmin" })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "Manage permissions for Superadmin" })).toBeChecked();
    // And the key cannot be handed to another role.
    await expect(page.getByRole("checkbox", { name: "Manage permissions for Admin" })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "Manage permissions for Admin" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "View customers for Admin" })).toBeEnabled();
  });

  test("a superadmin grants a permission, the role gets the page at once, and revoking takes it away again", async ({ browser }) => {
    test.setTimeout(120_000);
    const superadmin = await asRole(browser, "SUPERADMIN");
    const management = await asRole(browser, "MANAGEMENT");
    await expect(nav(management).getByRole("link", { name: "Customers" })).toHaveCount(0);
    await expectNotFound(management, "/customers", "Search customers");

    const save = async (grant: boolean) => {
      await openEditor(superadmin);
      const box = superadmin.getByRole("checkbox", { name: "View customers for Management" });
      if (grant) await box.check();
      else await box.uncheck();
      await superadmin.getByRole("button", { name: "Save permissions" }).click();
      await expect(superadmin.getByRole("status").filter({ hasText: "Saved 1 change." })).toBeVisible();
    };

    try {
      await save(true);

      // The next request of the other user already follows the new rules: the menu entry and the page itself.
      await management.goto("/dashboard/management");
      await expect(nav(management).getByRole("link", { name: "Customers" })).toBeVisible();
      await management.goto("/customers");
      await expect(management.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();

      // The editor marks it as changed, and the change is in the audit log.
      await openEditor(superadmin);
      await expect(superadmin.getByRole("row", { name: /View customers/ }).getByText("changed from the default")).toHaveCount(1);
      await superadmin.goto("/admin/audit");
      await expect(superadmin.getByRole("cell", { name: "permissions.updated" }).first()).toBeVisible();
    } finally {
      await save(false);
    }

    await management.goto("/dashboard/management");
    await expect(nav(management).getByRole("link", { name: "Customers" })).toHaveCount(0);
    await expectNotFound(management, "/customers", "Search customers");
  });
});
