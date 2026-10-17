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
