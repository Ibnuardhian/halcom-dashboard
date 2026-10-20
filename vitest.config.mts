import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // The files share one database per run, and the dashboard tests compare whole-table counts with what the dashboards
          // report, so the files run one after another. Tests inside a file still run in order.
          fileParallelism: false,
          globalSetup: ["tests/integration/global-setup.ts"],
        },
      },
    ],
  },
});
