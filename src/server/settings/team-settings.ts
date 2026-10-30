import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { DEFAULT_SLA, formatSlaRange, isValidSlaRange, parseSlaRange, SLA_MAX_DAYS, type SlaRange } from "@/domain/requests/sla";
import { parseRecipients } from "@/domain/requests/email";
import { DEFAULT_TEMPLATES, TEMPLATE_TEAMS, validateTemplate, type TemplateTeam } from "@/domain/requests/template";

type Actor = { id: string; role: Role };

export type TeamSetting = {
  role: TemplateTeam;
  /** The SLA as a range of days: an answer is expected after `minDays` and due after `maxDays`. */
  sla: SlaRange;
  emailSubject: string;
  emailBody: string;
  /** Comma-separated To and Cc addresses; empty while the server settings apply. */
  emailTo: string;
  emailCc: string;
  /** True while the team has no saved row and the application's defaults apply. */
  isDefault: boolean;
  updatedAt: Date | null;
  updatedByName: string | null;
};

/** The setting of one receiving team: what the superadmin saved, or the defaults. Anyone who reads requests may read it. */
export async function getTeamSetting(db: PrismaClient | Prisma.TransactionClient, role: TemplateTeam): Promise<TeamSetting> {
  const row = await db.teamSetting.findUnique({ where: { role }, include: { updatedBy: { select: { name: true } } } });
  if (!row) {
    const fallback = DEFAULT_TEMPLATES[role];
    return { role, sla: fallback.sla, emailSubject: fallback.subject, emailBody: fallback.body, emailTo: "", emailCc: "", isDefault: true, updatedAt: null, updatedByName: null };
  }
  const stored = { minDays: row.slaMinDays, maxDays: row.slaDays };
  return {
    role,
    sla: isValidSlaRange(stored) ? stored : DEFAULT_SLA,
    emailSubject: row.emailSubject,
    emailBody: row.emailBody,
    emailTo: row.emailTo,
    emailCc: row.emailCc,
    isDefault: false,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedBy?.name ?? null,
  };
}

/** Both teams' settings, by role. */
export async function getTeamSettings(db: PrismaClient): Promise<Record<TemplateTeam, TeamSetting>> {
  const [soa, purchasing] = await Promise.all([getTeamSetting(db, "SOA"), getTeamSetting(db, "PURCHASING")]);
  return { SOA: soa, PURCHASING: purchasing };
}

const saveSchema = z
  .object({
    role: z.enum(TEMPLATE_TEAMS),
    /** Written as a number of days or a range: "3", "2-3", "1-4". */
    sla: z.string().max(40),
    emailSubject: z.string().max(1000),
    emailBody: z.string().max(20_000),
    /** Addresses separated by a comma or semicolon; empty keeps the server settings. */
    emailTo: z.string().max(2000).default(""),
    emailCc: z.string().max(2000).default(""),
    /** Throw away the saved template and go back to the defaults (the SLA is kept as entered). */
    restoreDefaults: z.boolean().optional(),
  })
  .strict();

export type SaveSettingResult = { ok: true; changed: boolean } | { ok: false; code: "FORBIDDEN" | "INVALID_INPUT"; message: string };

/**
 * Saves a team's SLA (a number of days or a range such as 2-3, at most 7 days) and email template. Superadmin only; the
 * stored actor is re-read in the transaction. An invalid template (unknown variable, no {{request_id}} in the subject) is
 * refused with the reasons.
 */
export async function saveTeamSetting(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<SaveSettingResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Pengaturan yang dikirim tidak valid." };
  if (!can(claimedActor.role, "settings.manage")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };
  const { role, restoreDefaults } = parsed.data;
  const sla = parseSlaRange(parsed.data.sla);
  if (!sla) return { ok: false, code: "INVALID_INPUT", message: `Tulis SLA sebagai jumlah hari atau rentang seperti 2-3, dari 1 sampai ${SLA_MAX_DAYS} hari.` };
  const emailSubject = restoreDefaults ? DEFAULT_TEMPLATES[role].subject : parsed.data.emailSubject.replace(/\s+/g, " ").trim();
  const emailBody = restoreDefaults ? DEFAULT_TEMPLATES[role].body : parsed.data.emailBody.replace(/\r\n/g, "\n").trim();
  const problems = validateTemplate(emailSubject, emailBody);
  if (problems.length > 0) return { ok: false, code: "INVALID_INPUT", message: problems.join(" ") };
  const to = parseRecipients(parsed.data.emailTo);
  const cc = parseRecipients(parsed.data.emailCc);
  const invalidAddresses = [...to.invalid, ...cc.invalid];
  if (invalidAddresses.length > 0) return { ok: false, code: "INVALID_INPUT", message: `Alamat email tidak valid: ${invalidAddresses.join(", ")}.` };
  const emailTo = to.addresses.join(", ");
  // An address in To is not repeated in Cc.
  const toKeys = new Set(to.addresses.map((address) => address.toLowerCase()));
  const emailCc = cc.addresses.filter((address) => !toKeys.has(address.toLowerCase())).join(", ");

  return db.$transaction(async (tx): Promise<SaveSettingResult> => {
    const actor = await tx.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, "settings.manage")) return { ok: false, code: "FORBIDDEN", message: "Anda tidak diizinkan melakukan ini." };

    const before = await getTeamSetting(tx, role);
    const sameSla = before.sla.minDays === sla.minDays && before.sla.maxDays === sla.maxDays;
    if (sameSla && before.emailSubject === emailSubject && before.emailBody === emailBody && before.emailTo === emailTo && before.emailCc === emailCc && !before.isDefault) return { ok: true, changed: false };

    await tx.teamSetting.upsert({
      where: { role },
      create: { role, slaMinDays: sla.minDays, slaDays: sla.maxDays, emailSubject, emailBody, emailTo, emailCc, updatedById: actor.id },
      update: { slaMinDays: sla.minDays, slaDays: sla.maxDays, emailSubject, emailBody, emailTo, emailCc, updatedById: actor.id },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "team_settings.saved",
        entityType: "team_settings",
        entityId: role,
        before: { sla: formatSlaRange(before.sla), emailSubject: before.emailSubject, emailBody: before.emailBody, emailTo: before.emailTo, emailCc: before.emailCc, isDefault: before.isDefault },
        after: { sla: formatSlaRange(sla), emailSubject, emailBody, emailTo, emailCc, restoredDefaults: restoreDefaults === true },
      },
    });
    return { ok: true, changed: true };
  });
}
