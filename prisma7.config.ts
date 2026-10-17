import { defineConfig } from "prisma/config";

// DATABASE_URL is injected by Docker Compose (compose.yaml / compose.prod.yaml);
// no .env loading happens here. `prisma generate` does not need it.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
