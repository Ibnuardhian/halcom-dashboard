import type { NextConfig } from "next";

// Docker Desktop does not forward file-change events from Windows drives into
// Linux containers, so the dev container sets this to poll for changes instead.
const devPollIntervalMs = Number(process.env.NEXT_DEV_POLL_INTERVAL_MS) || undefined;

const nextConfig: NextConfig = {
  // Self-contained server bundle used by the production Docker image.
  output: "standalone",
  // AGENTS.md is this project's engineering charter; keep `next dev` from
  // inserting its managed agent-rules block into it.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  watchOptions: devPollIntervalMs ? { pollIntervalMs: devPollIntervalMs } : undefined,
  // The disposable test server (compose profile `test`) starts from a clean state every time: Turbopack's on-disk
  // dev cache went stale between runs there and made pages reload endlessly, so it is switched off for APP_ENV=test.
  experimental: process.env.APP_ENV === "test" ? { turbopackFileSystemCacheForDev: false } : undefined,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
