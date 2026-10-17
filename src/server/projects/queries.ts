import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import type { ProjectActionKind } from "@/domain/projects/actions";

type Viewer = { id: string; role: Role };

export type ProjectChangeRow = {
  id: string;
  field: string;
  fromValue: string | null;
  toValue: string | null;
  changedByName: string;
  changedAt: Date;
};

const LOG_LIMIT = 100;

/** The change log of a project, newest first. */
export async function listProjectChanges(db: PrismaClient, viewer: Viewer, projectId: string): Promise<ProjectChangeRow[]> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.projectChange.findMany({
    where: { projectId },
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    take: LOG_LIMIT,
    include: { changedBy: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    field: row.field,
    fromValue: row.fromValue,
    toValue: row.toValue,
    changedByName: row.changedBy.name,
    changedAt: row.changedAt,
  }));
}

export type ProjectActionRow = {
  id: string;
  kind: ProjectActionKind;
  body: string;
  /** Null for an entry that came from an import. */
  authorName: string | null;
  createdAt: Date;
};

const FEED_LIMIT = 100;

/** The project's current-action and next-action feed, newest first. */
export async function listProjectActions(db: PrismaClient, viewer: Viewer, projectId: string): Promise<ProjectActionRow[]> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.projectAction.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: FEED_LIMIT,
    include: { author: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, kind: row.kind, body: row.body, authorName: row.author?.name ?? null, createdAt: row.createdAt }));
}
