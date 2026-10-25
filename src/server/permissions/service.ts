import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  ALL_PERMISSIONS,
  can,
  computeEffectivePermissions,
  defaultPermissionsFor,
  permissionChangeBlock,
  setPermissionOverrides,
  type Permission,
} from "@/domain/access/permissions";
import { ROLES, type Role } from "@/domain/access/roles";

type Db = PrismaClient | Prisma.TransactionClient;
type Actor = { id: string; role: Role };

/** The stored deviations from the default permissions. */
export async function listPermissionOverrides(db: Db): Promise<{ role: Role; permission: string; granted: boolean }[]> {
  return db.rolePermissionOverride.findMany({ select: { role: true, permission: true, granted: true }, orderBy: [{ role: "asc" }, { permission: "asc" }] });
}

/**
 * Refreshes what `can()` answers from the database. Called at the start of every authenticated request, so a change made in one
 * process reaches the others on their next request. If the read fails the request fails: falling back to the defaults could give back a permission that was taken away.
 */
export async function loadPermissionOverrides(db: Db): Promise<void> {
  setPermissionOverrides(await listPermissionOverrides(db));
}

const changeSchema = z
  .object({ role: z.enum(ROLES), permission: z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]), granted: z.boolean() })
  .strict();
const saveSchema = z.object({ changes: z.array(changeSchema).min(1).max(ROLES.length * ALL_PERMISSIONS.length) }).strict();

export type PermissionChange = z.infer<typeof changeSchema>;
export type SavePermissionsResult =
  | { ok: true; changed: number }
  | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT" | "BLOCKED"; message: string };

const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";

/**
 * Grants and revokes permissions of roles. Only an actor who holds `permissions.manage` (a superadmin by default) may call it, and
 * the stored actor is re-checked inside the transaction against the permissions as they are in the database right now.
 *
 * All changes are applied together or not at all: if any asks for something the guards forbid (taking `permissions.manage` or
 * account management away from Superadmin, handing `permissions.manage` to another role) nothing is saved. A change that restates
 * what a role already has is skipped. A permission set back to its default removes its row, so the table only holds deviations.
 * Each role with changes gets one audit event with the before and after.
 */
export async function savePermissionChanges(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<SavePermissionsResult> {
  // A quick refusal before any work; the transaction below decides again from the stored account and the stored rules.
  if (!can(claimedActor.role, "permissions.manage")) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "That change is not valid. Reload the page and try again." };

  const result = await db.$transaction(async (tx): Promise<SavePermissionsResult> => {
    // One editor at a time: the checks below read the current rows and must still be true when the rows are written.
    await tx.$executeRaw`LOCK TABLE role_permission_overrides IN SHARE ROW EXCLUSIVE MODE`;
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    const rows = await listPermissionOverrides(tx);
    const effective = computeEffectivePermissions(rows);
    if (!actor?.isActive || !effective[actor.role].has("permissions.manage")) return { ok: false, code: "FORBIDDEN", message: FORBIDDEN };

    // Last write wins when the same pair is listed twice.
    const wanted = new Map<string, PermissionChange>();
    for (const change of parsed.data.changes) wanted.set(`${change.role}:${change.permission}`, change);

    const applied = [...wanted.values()].filter((change) => effective[change.role].has(change.permission) !== change.granted);
    for (const change of applied) {
      const block = permissionChangeBlock(change.role, change.permission, change.granted);
      if (block) return { ok: false, code: "BLOCKED", message: `${change.permission} for ${change.role}: ${block}` };
    }

    const byRole = new Map<Role, PermissionChange[]>();
    for (const change of applied) byRole.set(change.role, [...(byRole.get(change.role) ?? []), change]);

    for (const [role, changes] of byRole) {
      for (const { permission, granted } of changes) {
        if (defaultPermissionsFor(role).has(permission) === granted) {
          await tx.rolePermissionOverride.deleteMany({ where: { role, permission } });
        } else {
          await tx.rolePermissionOverride.upsert({
            where: { role_permission: { role, permission } },
            update: { granted, updatedById: actor.id },
            create: { role, permission, granted, updatedById: actor.id },
          });
        }
      }
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "permissions.updated",
          entityType: "role_permissions",
          entityId: role,
          before: Object.fromEntries(changes.map(({ permission }) => [permission, effective[role].has(permission)])),
          after: Object.fromEntries(changes.map(({ permission, granted }) => [permission, granted])),
        },
      });
    }
    return { ok: true, changed: applied.length };
  });

  // The saving process answers with the new rules from now on; the others pick them up on their next request.
  if (result.ok) await loadPermissionOverrides(db);
  return result;
}
