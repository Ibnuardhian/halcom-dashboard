import { defineConfig } from "prisma/config";

// DATABASE_URL is injected by Docker Compose (compose.yaml / compose.prod.yaml);
// no .env loading happens here. `prisma generate` does not need it.
// With Neon (compose.neon.yaml) DIRECT_URL is the non-pooled address: migrations need a
// session-level connection, which a pooler (pgbouncer) does not give. Locally it is unset.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
