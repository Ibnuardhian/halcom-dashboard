import { Prisma, type Project } from "@/generated/prisma/client";
import { diffCommercial, type CommercialChange, type CommercialField, type CommercialValue } from "@/domain/projects/commercial";
import { categoryOf } from "@/domain/projects/growth";

type Tx = Prisma.TransactionClient;
export type CommercialSubmission = Partial<Record<CommercialField, CommercialValue>>;

/** `2026-10-17`: the calendar day of a moment in Asia/Jakarta, the business time zone. */
export const jakartaDay = (moment: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(moment);

/**
 * What a commercial edit really changes on a project, with the stage-date rules applied (they can add Progress or a date to
 * `submitted`, which is why it is changed in place). Writes nothing: the single edit and the bulk update both plan with this, so a
 * sheet moves a project exactly as the form would.
 */
export function planCommercialChanges(project: Project, submitted: CommercialSubmission): CommercialChange[] {
  const dateText = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
  const current = {
    createdAt: jakartaDay(project.createdAt),
    progress: project.progress,
    trackStatus: project.trackStatus,
    estimatedValue: project.estimatedValue?.toNumber() ?? null,
    targetMargin: project.targetMargin?.toNumber() ?? null,
    targetMarginValue: project.targetMarginValue?.toNumber() ?? null,
    quoteReleasedAt: dateText(project.quoteReleasedAt),
    targetDate: dateText(project.targetDate),
    finalValue: project.finalValue?.toNumber() ?? null,
    wonDate: dateText(project.wonDate),
  };
  // The three stage dates (Opportunity = created, Quoted = quote released, Closed Won = won date) are kept in step with Progress in
  // both directions. Setting a Quoted or Closed Won date by hand is what the sales export calls reaching that stage, so it moves
  // Progress forward to match, the same as it would if Progress had been changed instead; typing a date never moves Progress back.
  if (
    "quoteReleasedAt" in submitted &&
    submitted.quoteReleasedAt !== null &&
    submitted.quoteReleasedAt !== current.quoteReleasedAt &&
    categoryOf(String(submitted.progress ?? current.progress)) === "OPPORTUNITY"
  ) {
    submitted.progress = "PROPOSE";
  }
  if (
    "wonDate" in submitted &&
    submitted.wonDate !== null &&
    submitted.wonDate !== current.wonDate &&
    (submitted.progress ?? current.progress) !== "CLOSED_WON"
  ) {
    submitted.progress = "CLOSED_WON";
  }
  // Closing a project as won with no won date puts it in the quarter it was closed in (today), so it counts toward the target.
  if (submitted.progress === "CLOSED_WON" && current.progress !== "CLOSED_WON" && current.wonDate === null && (submitted.wonDate ?? null) === null) {
    submitted.wonDate = jakartaDay(new Date());
  }
  // Moving to Propose (30%) means the quotation was submitted: with no date yet, today is filled in. It stays editable (and can be
  // cleared) afterwards, so a date typed in the same change wins and later schedule changes are free.
  if (submitted.progress === "PROPOSE" && current.progress !== "PROPOSE" && current.quoteReleasedAt === null && (submitted.quoteReleasedAt ?? null) === null) {
    submitted.quoteReleasedAt = jakartaDay(new Date());
  }
  return diffCommercial(current, submitted);
}

/** Writes the planned changes: the project, one change-log row per field and the audit event. The caller holds the row lock. */
export async function writeCommercialChanges(tx: Tx, actorId: string, project: Project, submitted: CommercialSubmission, changes: CommercialChange[]): Promise<void> {
  await tx.project.update({
    where: { id: project.id },
    data: Object.fromEntries(
      changes.map((change) => {
        const value = submitted[change.field] ?? null; // already a number, a date string or null
        // The creation date is a moment, not a plain date: the chosen day starts at midnight in Jakarta.
        if (change.field === "createdAt") return [change.field, new Date(`${value}T00:00:00+07:00`)];
        const isDate = change.field === "targetDate" || change.field === "quoteReleasedAt" || change.field === "wonDate";
        return [change.field, isDate && typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value];
      }),
    ),
  });
  const now = new Date();
  await tx.projectChange.createMany({
    data: changes.map((change) => ({
      projectId: project.id,
      changedById: actorId,
      field: change.field,
      fromValue: change.from,
      toValue: change.to,
      changedAt: now,
    })),
  });
  await tx.auditEvent.create({
    data: {
      actorId: actorId,
      action: "project.commercial_updated",
      entityType: "project",
      entityId: project.id,
      before: Object.fromEntries(changes.map((change) => [change.field, change.from])) as Prisma.InputJsonValue,
      after: Object.fromEntries(changes.map((change) => [change.field, change.to])) as Prisma.InputJsonValue,
    },
  });
}
