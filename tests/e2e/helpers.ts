import { expect, type Page } from "@playwright/test";
import type { Role } from "@/domain/access/roles";
import { seedEmailFor } from "../../prisma/seed-users";

export const SEED_PASSWORD = process.env["SEED_USER_PASSWORD"] ?? "";

/** Fills in and submits the login form without waiting for the outcome. */
export async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Signs in as a seeded user and waits until the session cookie is set and the app has
 * navigated away from the login page. Navigating earlier would cut the login short.
 */
export async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await submitLogin(page, email, password);
  await expect(page).not.toHaveURL(/\/login$/);
}

export async function signIn(page: Page, role: Role, password: string = SEED_PASSWORD): Promise<void> {
  await signInAs(page, seedEmailFor(role), password);
}

export async function expectOnDashboard(page: Page, path: string, heading: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}
