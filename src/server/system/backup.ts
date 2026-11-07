import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";

// The backup folder is outside the project (a mounted host folder chosen at run time), so the file calls below carry
// `turbopackIgnore`: without it the build traces the whole project, including git-ignored data, into the standalone output.
const execFileAsync = promisify(execFile);

/** Where backups are written inside the container; compose bind-mounts a host folder here. */
export const DEFAULT_BACKUP_DIR = "/backups";
const BACKUP_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * `halcom-20261017-153000Z.dump` (made from this page) or `halcom-auto-20261017-153000Z.dump` (the daily job on the server,
 * deploy/backup-daily.sh): UTC time, so names sort chronologically on any machine. Only these names are listed or downloaded.
 */
const BACKUP_NAME = /^halcom-(?:auto-)?\d{8}-\d{6}Z\.dump$/;

export function backupFileName(now: Date): string {
  const iso = now.toISOString(); // 2026-10-17T15:30:00.000Z
  return `halcom-${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}Z.dump`;
}

export function isBackupFileName(name: string): boolean {
  return BACKUP_NAME.test(name);
}

/** The daily job's files, which that job (not the application) removes after its retention period. */
export function isAutomaticBackup(name: string): boolean {
  return name.startsWith("halcom-auto-");
}

export type BackupFile = { name: string; sizeBytes: number; modifiedAt: Date };

export type BackupDirectoryState =
  | { ok: true; dir: string; files: BackupFile[] }
  | { ok: false; dir: string; error: string };

export function backupDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env["BACKUP_DIR"] || DEFAULT_BACKUP_DIR;
}

/** Lists finished backups, newest first. Partial and unrelated files are ignored. */
export async function listBackups(dir: string = backupDir()): Promise<BackupDirectoryState> {
  try {
    const names = (await readdir(/*turbopackIgnore: true*/ dir)).filter(isBackupFileName);
    const files = await Promise.all(
      names.map(async (name) => {
        const info = await stat(path.join(/*turbopackIgnore: true*/ dir, name));
        return { name, sizeBytes: info.size, modifiedAt: info.mtime };
      }),
    );
    files.sort((a, b) => b.name.localeCompare(a.name));
    return { ok: true, dir, files };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      dir,
      error: code === "ENOENT" ? "Folder backup belum di-mount atau belum ada." : "The backup folder cannot be read.",
    };
  }
}

/** Connection settings for pg_dump as environment variables, so the password never appears in the process list. */
export function pgEnvFromUrl(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
}

export type Exec = (file: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; timeout: number }) => Promise<unknown>;

export type BackupOptions = {
  dir?: string;
  databaseUrl?: string;
  now?: Date;
  /** Replaceable in tests. */
  exec?: Exec;
};

export type BackupResult =
  | { ok: true; file: BackupFile }
  | { ok: false; code: "FORBIDDEN" | "BUSY" | "FAILED"; message: string };

let running = false;

/** The stored, active user, when the claimed role may handle backups: the claim alone is not trusted. */
async function backupActor(db: PrismaClient, claimedActor: { id: string; role: Role }): Promise<{ id: string; role: Role } | null> {
  if (!can(claimedActor.role, "system.backup")) return null;
  const actor = await db.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
  return actor?.isActive && can(actor.role, "system.backup") ? { id: actor.id, role: actor.role } : null;
}

export type BackupDownload =
  | { ok: true; file: BackupFile; path: string }
  | { ok: false; code: "FORBIDDEN" | "NOT_FOUND"; message: string };

/**
 * Checks that this user may download this backup and that the file exists, and writes the download to the audit log. Only names
 * of the two backup patterns are accepted, so a path such as `../x` never reaches the file system. The route streams `path`.
 */
export async function prepareBackupDownload(
  db: PrismaClient,
  claimedActor: { id: string; role: Role },
  name: string,
  options: { dir?: string } = {},
): Promise<BackupDownload> {
  const actor = await backupActor(db, claimedActor);
  if (!actor) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };
  if (!isBackupFileName(name)) return { ok: false, code: "NOT_FOUND", message: "Backup tidak ditemukan." };
  const filePath = path.join(/*turbopackIgnore: true*/ options.dir ?? backupDir(), name);
  const info = await stat(/*turbopackIgnore: true*/ filePath).catch(() => null);
  if (!info?.isFile()) return { ok: false, code: "NOT_FOUND", message: "Backup tidak ditemukan." };
  await db.auditEvent.create({
    data: {
      actorId: actor.id,
      action: "system.backup_downloaded",
      entityType: "system",
      entityId: name,
      before: Prisma.JsonNull,
      after: { name, sizeBytes: info.size },
    },
  });
  return { ok: true, file: { name, sizeBytes: info.size, modifiedAt: info.mtime }, path: filePath };
}

/**
 * Writes a PostgreSQL custom-format dump to the host-mounted backup folder (decision T-11: a host
 * folder). The dump is written to a `.partial` file, checked with `pg_restore --list`, and only
 * then renamed, so a half-written file never looks like a backup. Existing files are never
 * overwritten or deleted. Restoring is a manual, approved step (README › Backups).
 */
export async function createBackup(
  db: PrismaClient,
  claimedActor: { id: string; role: Role },
  options: BackupOptions = {},
): Promise<BackupResult> {
  const actor = await backupActor(db, claimedActor);
  if (!actor) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };
  if (running) return { ok: false, code: "BUSY", message: "Backup sedang berjalan." };

  const databaseUrl = options.databaseUrl ?? process.env["DATABASE_URL"];
  if (!databaseUrl) return { ok: false, code: "FAILED", message: "DATABASE_URL is not set." };
  const dir = options.dir ?? backupDir();
  const exec = options.exec ?? (execFileAsync as unknown as Exec);
  const name = backupFileName(options.now ?? new Date());
  const finalPath = path.join(/*turbopackIgnore: true*/ dir, name);
  const partialPath = `${finalPath}.partial`;

  running = true;
  try {
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    if (await exists(finalPath)) return { ok: false, code: "FAILED", message: "Backup dengan nama ini sudah ada. Tunggu sebentar lalu coba lagi." };

    const env = { ...process.env, ...pgEnvFromUrl(databaseUrl) };
    await exec("pg_dump", ["--format=custom", "--no-owner", "--file", partialPath], { env, timeout: BACKUP_TIMEOUT_MS });
    await exec("pg_restore", ["--list", partialPath], { env, timeout: BACKUP_TIMEOUT_MS });
    await chmod(/*turbopackIgnore: true*/ partialPath, 0o600);
    await rename(/*turbopackIgnore: true*/ partialPath, /*turbopackIgnore: true*/ finalPath);

    const info = await stat(/*turbopackIgnore: true*/ finalPath);
    const file = { name, sizeBytes: info.size, modifiedAt: info.mtime };
    await db.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "system.backup_created",
        entityType: "system",
        entityId: name,
        before: Prisma.JsonNull,
        after: { name, sizeBytes: info.size },
      },
    });
    return { ok: true, file };
  } catch (error) {
    await rm(/*turbopackIgnore: true*/ partialPath, { force: true }).catch(() => undefined);
    return { ok: false, code: "FAILED", message: describeFailure(error) };
  } finally {
    running = false;
  }
}

async function exists(file: string): Promise<boolean> {
  return stat(/*turbopackIgnore: true*/ file).then(
    () => true,
    () => false,
  );
}

/** A short, safe message: never the command line or environment, which could carry connection details. */
function describeFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "pg_dump belum terpasang di container ini. Bangun ulang image (docker compose build).";
  if (code === "EACCES" || code === "EROFS") return "Folder backup tidak bisa ditulis oleh aplikasi.";
  const stderr = (error as { stderr?: unknown }).stderr;
  const firstLine = typeof stderr === "string" ? stderr.split("\n").find((line) => line.trim() !== "") : undefined;
  return firstLine ? `The backup failed: ${firstLine.trim().slice(0, 200)}` : "The backup failed. Check the application log.";
}
