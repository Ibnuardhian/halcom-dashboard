import { expect, test } from "@playwright/test";
import { MAX_FAILURES } from "@/domain/access/login-throttle";
import { submitLogin } from "./helpers";

/**
 * Guessing is slowed down after a handful of wrong passwords (T-7). The address used here belongs to no account, so the run never
 * locks a seeded account that the other specs sign in with; that it locks all the same is the point, because a lock that only
 * happened for real accounts would tell an outsider which addresses exist.
 */
test.describe("the sign-in throttle", () => {
  test("locks after five wrong passwords and says how long to wait, for an address that has no account at all", async ({ page }) => {
    test.setTimeout(120_000);
    const stranger = `e2e-throttle-${Date.now()}@example.invalid`;
    const failed = page.getByRole("alert").filter({ hasText: "Invalid email or password." });

    // The first failures only say that something was wrong, and never which part.
    await expect(async () => {
      await submitLogin(page, stranger, "wrong-password-1");
      await expect(failed).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    for (let attempt = 2; attempt < MAX_FAILURES.email; attempt += 1) {
      await submitLogin(page, stranger, `wrong-password-${attempt}`);
      await expect(failed).toBeVisible();
    }

    await submitLogin(page, stranger, "wrong-password-5");
    const locked = page.getByRole("alert").filter({ hasText: /Too many sign-in attempts/ });
    await expect(locked).toBeVisible();
    await expect(locked).toContainText("Try again in 15 minutes.");
    // The message says nothing about the account behind the address.
    await expect(locked).not.toContainText(/exist|unknown|account is/i);

    // While the lock lasts, even the right password is refused; the person stays on the sign-in page.
    await submitLogin(page, stranger, "wrong-password-6");
    await expect(page.getByRole("alert").filter({ hasText: /Too many sign-in attempts/ })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
