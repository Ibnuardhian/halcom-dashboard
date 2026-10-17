import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// One client per server process; dev hot reloads would otherwise open new pools.
const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }
  // node-postgres waits indefinitely for a connection by default; fail fast instead.
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 });
  return new PrismaClient({ adapter });
}

/** Returns the shared Prisma client, created on first use rather than at import time. */
export function getDb(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}
