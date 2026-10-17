import { defineConfig, devices } from "@playwright/test";

// E2E tests run in the `e2e` compose service against the isolated `app-test`
// stack, which sets PLAYWRIGHT_BASE_URL (see compose.yaml).
export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env["CI"]),
  // No automatic retries: a flaky test must surface as a failure.
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
