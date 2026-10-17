import os from "node:os";
import { performance } from "node:perf_hooks";
import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Actor } from "@/server/users/service";

export type ConnectionStats = {
  state: string;
  count: number;
  /** Age in seconds of the oldest statement in this state, or null when idle. */
  oldestSeconds: number | null;
};

export type TableStats = { name: string; sizeBytes: number; estimatedRows: number };

export type SystemSnapshot = {
  generatedAt: Date;
  app: {
    environment: string;
    nodeVersion: string;
    uptimeSeconds: number;
    memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
    /** Share of time the event loop was busy since the process started (0 to 1). */
    eventLoopUtilization: number;
    /** Host VM figures: containers report the VM, not their own limits. */
    vm: { loadAverage1m: number; totalMemoryBytes: number; freeMemoryBytes: number };
  };
  database: {
    name: string;
    version: string;
    sizeBytes: number;
    latencyMs: number;
    maxConnections: number;
    /** Other sessions on this database; this request's own connection is excluded. */
    connections: ConnectionStats[];
    cacheHitRatio: number | null;
    commits: number;
    rollbacks: number;
    deadlocks: number;
    largestTables: TableStats[];
  };
};

type DatabaseRow = {
  name: string;
  size_bytes: number;
  max_connections: number;
  commits: number;
  rollbacks: number;
  blocks_hit: number;
  blocks_read: number;
  deadlocks: number;
};

/**
 * A point-in-time view of application and database health for the superadmin System page.
 * It reads counts, sizes and timings only: never query text or row contents, because
 * those can contain business data.
 */
export async function getSystemSnapshot(db: PrismaClient, actor: Actor): Promise<SystemSnapshot> {
  if (!can(actor.role, "system.monitor")) throw new Error("Forbidden: missing permission for this query.");

  const startedAt = performance.now();
  await db.$queryRaw`SELECT 1`;
  const latencyMs = performance.now() - startedAt;

  const [versionRows, databaseRows, activityRows, tableRows] = await Promise.all([
    db.$queryRaw<{ version: string }[]>`SELECT version() AS version`,
    db.$queryRaw<DatabaseRow[]>`
      SELECT current_database() AS name,
             pg_database_size(current_database())::float8 AS size_bytes,
             (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
             d.xact_commit::float8 AS commits,
             d.xact_rollback::float8 AS rollbacks,
             d.blks_hit::float8 AS blocks_hit,
             d.blks_read::float8 AS blocks_read,
             d.deadlocks::float8 AS deadlocks
        FROM pg_stat_database d
       WHERE d.datname = current_database()`,
    db.$queryRaw<{ state: string; count: number; oldest_seconds: number | null }[]>`
      SELECT coalesce(state, 'background') AS state,
             count(*)::int AS count,
             max(extract(epoch FROM (now() - query_start))) FILTER (WHERE state <> 'idle')::float8 AS oldest_seconds
        FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()
       GROUP BY 1
       ORDER BY 1`,
    db.$queryRaw<{ name: string; size_bytes: number; estimated_rows: number }[]>`
      SELECT relname AS name,
             pg_total_relation_size(relid)::float8 AS size_bytes,
             n_live_tup::float8 AS estimated_rows
        FROM pg_stat_user_tables
       ORDER BY size_bytes DESC, relname
       LIMIT 8`,
  ]);

  const database = databaseRows[0];
  if (!database) throw new Error("pg_stat_database returned no row for the current database.");
  const blocks = database.blocks_hit + database.blocks_read;
  const memory = process.memoryUsage();

  return {
    generatedAt: new Date(),
    app: {
      environment: process.env["APP_ENV"] ?? "unknown",
      nodeVersion: process.version,
      uptimeSeconds: process.uptime(),
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
      eventLoopUtilization: performance.eventLoopUtilization().utilization,
      vm: { loadAverage1m: os.loadavg()[0] ?? 0, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem() },
    },
    database: {
      name: database.name,
      version: versionRows[0]?.version.split(" ").slice(0, 2).join(" ") ?? "unknown",
      sizeBytes: database.size_bytes,
      latencyMs,
      maxConnections: database.max_connections,
      connections: activityRows.map((row) => ({
        state: row.state,
        count: row.count,
        oldestSeconds: row.oldest_seconds,
      })),
      cacheHitRatio: blocks === 0 ? null : database.blocks_hit / blocks,
      commits: database.commits,
      rollbacks: database.rollbacks,
      deadlocks: database.deadlocks,
      largestTables: tableRows.map((row) => ({
        name: row.name,
        sizeBytes: row.size_bytes,
        estimatedRows: row.estimated_rows,
      })),
    },
  };
}
