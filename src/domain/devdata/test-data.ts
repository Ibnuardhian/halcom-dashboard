/**
 * How a development project is recognised as test data. The rule is deliberately narrow: a record that does not meet every point stays
 * untouched and is reported, because deleting real data costs more than keeping a stray test record.
 */

/** Idempotency keys of the sample records the development seed creates (prisma/seed-sample.ts). Never test data to clean up. */
export const SEED_KEY_PREFIX = "seed-dev-v1:";

/** Placeholder company names typed in by hand while testing ("PT ABCD", "PT EFGH"): "PT " and four capital letters. */
export const PLACEHOLDER_CUSTOMER = /^PT [A-Z]{4}$/;

export type ProjectEvidence = {
  createdAt: Date;
  importedFrom: string | null;
  submissionKey: string | null;
  customerName: string | null;
  deletedAt: Date | null;
};

export type Classification = { test: true; evidence: string[] } | { test: false; reason: string };

/** Is this project confirmed test data for the given day (`window` is the start and end of that day in the application's time zone)? */
export function classifyProject(project: ProjectEvidence, window: { start: Date; end: Date }): Classification {
  if (project.deletedAt) return { test: false, reason: "already deleted" };
  const inWindow = project.createdAt >= window.start && project.createdAt < window.end;
  if (!inWindow) return { test: false, reason: "created outside the chosen day" };
  if (project.importedFrom) return { test: false, reason: `imported from ${project.importedFrom} (the sales export is real data)` };
  if (!project.submissionKey) return { test: false, reason: "not created through the project form" };
  if (project.submissionKey.startsWith(SEED_KEY_PREFIX)) return { test: false, reason: "a sample record of the development seed" };
  if (!project.customerName || !PLACEHOLDER_CUSTOMER.test(project.customerName)) return { test: false, reason: "the company name is not a placeholder like PT ABCD" };
  return {
    test: true,
    evidence: [
      "created on the chosen day",
      "not imported from the sales export",
      "created through the project form (has a submission key)",
      `placeholder company name "${project.customerName}"`,
    ],
  };
}
