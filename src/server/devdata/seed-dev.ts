import type { PrismaClient } from "@/generated/prisma/client";
import { ROLES, type Role } from "@/domain/access/roles";
import { hashPassword } from "@/server/auth/password";
import { DEV_SALES_ACCOUNTS, seedEmailFor, seedNameFor } from "@/domain/devdata/accounts";
import { SEED_KEY_PREFIX } from "@/domain/devdata/test-data";
import { createMasterRecord, setProjectMasterData } from "@/server/masterdata/service";
import { assignRequestPic, createPic } from "@/server/pics/service";
import { changeRequestStatus, createProject, handOverToPurchasing, type Actor } from "@/server/requests/service";

/**
 * The development dataset, as repeatable seeders (D-032). Everything here goes through the same services the application uses, with
 * fixed names and fixed idempotency keys (`seed-dev-v1:...`), so running it again finds what exists and adds nothing. It only adds:
 * no delete, truncate or reset, and an existing record is never overwritten. The data is synthetic; there are no passwords here.
 */

export { DEV_SALES_ACCOUNTS };

/** PICs are the operational assignees of SOA and Purchasing tickets; they are not login accounts. */
export const DEV_PICS = [
  { team: "SOA", name: "Adityo" },
  { team: "SOA", name: "Ibnu" },
  { team: "PURCHASING", name: "Gita" },
  { team: "PURCHASING", name: "Soraya" },
] as const;

export const DEV_PRINCIPALS = ["Fortinet", "HPE", "Cisco"] as const;
export const DEV_SOLUTIONS = ["Network Security", "Server & Storage", "CCTV & Surveillance"] as const;

type SampleRequestPlan = "BOQ_OPEN" | "BOQ_DONE_RFQ_OPEN" | "BOQ_DONE_RFQ_DONE_PO_OPEN";

type SampleProject = {
  key: string;
  customer: string;
  name: string;
  description: string;
  /** Email of the Sales owner; null for a project of source Other, which SOA registers. */
  owner: string | null;
  external?: { name: string; contact: string };
  progress: string;
  estimatedValue: string;
  principal: (typeof DEV_PRINCIPALS)[number] | null;
  solution: (typeof DEV_SOLUTIONS)[number] | null;
  plan: SampleRequestPlan | null;
};

/** Customer names are plainly fictional; none looks like the "PT ABCD" placeholders the test-data cleanup recognises. */
export const SAMPLE_PROJECTS: readonly SampleProject[] = [
  { key: "p1", customer: "Northwind Example", name: "Core switch refresh", description: "Replace the campus core switches.", owner: "dzaki@halcominovasi.co.id", progress: "UNDERSTAND", estimatedValue: "450000000", principal: "Cisco", solution: "Network Security", plan: "BOQ_OPEN" },
  { key: "p2", customer: "Contoso Example", name: "Branch CCTV rollout", description: "Cameras and recorders for twelve branches.", owner: "satrio@halcominovasi.co.id", progress: "PROPOSE", estimatedValue: "820000000", principal: "HPE", solution: "CCTV & Surveillance", plan: "BOQ_DONE_RFQ_OPEN" },
  { key: "p3", customer: "Fabrikam Example", name: "Datacenter storage expansion", description: "Add two storage shelves and licences.", owner: "dzaki@halcominovasi.co.id", progress: "NEGOTIATE", estimatedValue: "1250000000", principal: "HPE", solution: "Server & Storage", plan: "BOQ_DONE_RFQ_DONE_PO_OPEN" },
  { key: "p4", customer: "Adventure Example", name: "Guest Wi-Fi for partner site", description: "Registered by SOA for an outside sales partner.", owner: null, external: { name: "Partner Reseller Example", contact: "partner@example.invalid" }, progress: "QUALIFY", estimatedValue: "", principal: null, solution: null, plan: null },
  { key: "p5", customer: "Tailspin Example", name: "Firewall renewal", description: "Renew the firewall subscription.", owner: "satrio@halcominovasi.co.id", progress: "QUALIFY", estimatedValue: "95000000", principal: "Fortinet", solution: "Network Security", plan: null },
];

/**
 * One account per role plus the development Sales team, all with the same password (the caller reads it from the environment).
 * An account that exists is left exactly as it is, including a password changed since.
 */
export async function seedAccounts(db: PrismaClient, password: string): Promise<{ created: number; total: number }> {
  const people: { name: string; email: string; role: Role }[] = [
    ...ROLES.map((role) => ({ name: seedNameFor(role), email: seedEmailFor(role), role })),
    ...DEV_SALES_ACCOUNTS.map((person) => ({ ...person, role: "SALES" as const })),
  ];
  // The Sales role account of the tests is one of the Sales people, so it is listed once.
  const wanted = people.filter((account, index) => people.findIndex((other) => other.email === account.email) === index);
  let created = 0;
  for (const account of wanted) {
    if (await db.user.findUnique({ where: { email: account.email }, select: { id: true } })) continue;
    await db.user.create({ data: { ...account, passwordHash: await hashPassword(password) } });
    created += 1;
  }
  return { created, total: wanted.length };
}

const idempotencyKey = (key: string) => `${SEED_KEY_PREFIX}${key}`;

type Logger = (line: string) => void;

async function actorByEmail(db: PrismaClient, email: string, role: Role): Promise<Actor> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true, isActive: true } });
  if (!user || !user.isActive || user.role !== role) throw new Error(`The ${role} account ${email} is missing or inactive. Run "npm run db:seed" first.`);
  return { id: user.id, role: user.role };
}

/** Principals and solutions (master data) and the PICs. Existing records are left as they are. */
export async function seedMasterDataAndPics(db: PrismaClient, adminEmail: string, log: Logger = () => undefined): Promise<void> {
  const admin = await actorByEmail(db, adminEmail, "ADMIN");
  let added = 0;
  for (const name of DEV_PRINCIPALS) added += (await createMasterRecord(db, admin, { kind: "principal", name })).ok ? 1 : 0;
  for (const name of DEV_SOLUTIONS) added += (await createMasterRecord(db, admin, { kind: "solution", name })).ok ? 1 : 0;
  log(`master data: ${added} added, ${DEV_PRINCIPALS.length + DEV_SOLUTIONS.length - added} already there`);

  let pics = 0;
  for (const pic of DEV_PICS) pics += (await createPic(db, admin, pic)).ok ? 1 : 0;
  log(`PICs: ${pics} added, ${DEV_PICS.length - pics} already there`);
}

const ORDER = ["SUBMITTED", "IN_PROGRESS", "COMPLETED"] as const;

/** Moves a request forward to `target` through the allowed statuses; a request that is already there or further is left alone. */
async function advance(db: PrismaClient, actor: Actor, requestId: string, target: (typeof ORDER)[number]): Promise<void> {
  const rank = (status: string) => ORDER.indexOf(status as (typeof ORDER)[number]);
  for (const step of ORDER.slice(1)) {
    const current = await db.request.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } });
    if (rank(current.status) < 0 || rank(current.status) >= rank(step) || rank(step) > rank(target)) continue;
    const result = await changeRequestStatus(db, actor, { requestId, to: step });
    if (!result.ok) throw new Error(`Could not move the sample request to ${step}: ${result.message}`);
  }
}

async function pickPic(db: PrismaClient, actor: Actor, requestId: string, team: "SOA" | "PURCHASING", name: string): Promise<void> {
  const pic = await db.pic.findFirst({ where: { team, name }, select: { id: true } });
  if (!pic) return;
  const current = await db.request.findUniqueOrThrow({ where: { id: requestId }, select: { picId: true } });
  if (current.picId) return; // an assignment someone made since is kept
  const result = await assignRequestPic(db, actor, { requestId, picId: pic.id });
  if (!result.ok) throw new Error(`Could not assign ${name}: ${result.message}`);
}

/**
 * Representative projects with BOQ, RFQ and PO requests at different stages, owned by the development Sales accounts, plus one project
 * from an outside source. Needs `db:seed` first (accounts, PICs, principals and solutions).
 */
export async function seedSampleDataset(db: PrismaClient, log: Logger = () => undefined): Promise<{ projects: number; created: number }> {
  const soa = await actorByEmail(db, seedEmailFor("SOA"), "SOA");
  const purchasing = await actorByEmail(db, seedEmailFor("PURCHASING"), "PURCHASING");
  let created = 0;

  for (const sample of SAMPLE_PROJECTS) {
    const owner = sample.owner ? await actorByEmail(db, sample.owner, "SALES") : null;
    const actor = owner ?? soa;
    const made = await createProject(db, actor, {
      endUserCompany: sample.customer,
      name: sample.name,
      description: sample.description,
      submissionKey: idempotencyKey(sample.key),
      // Value and progress are Sales' to enter; a project SOA registers for an outside source leaves them empty.
      progress: owner ? sample.progress : "",
      estimatedValue: owner ? sample.estimatedValue : "",
      ...(sample.external ? { sourceType: "OTHER", externalSourceName: sample.external.name, externalContact: sample.external.contact } : {}),
      ...(sample.plan ? { request: { type: "BOQ", title: `Please prepare the BOQ for ${sample.name}` } } : {}),
    });
    if (!made.ok) throw new Error(`Sample project ${sample.key}: ${made.message}`);
    if (made.value.created) created += 1;

    if (sample.principal || sample.solution) {
      const principal = sample.principal ? await db.principal.findFirst({ where: { name: sample.principal }, select: { id: true } }) : null;
      const solution = sample.solution ? await db.solutionCategory.findFirst({ where: { name: sample.solution }, select: { id: true } }) : null;
      const project = await db.project.findUniqueOrThrow({ where: { id: made.value.id }, select: { principalId: true, solutionCategoryId: true } });
      // Only fill what is empty, so a classification made in the application is not overwritten.
      const data: Record<string, unknown> = { projectId: made.value.id };
      if (principal && !project.principalId) data["principalIds"] = [principal.id];
      if (solution && !project.solutionCategoryId) data["solutionId"] = solution.id;
      if (Object.keys(data).length > 1) {
        const result = await setProjectMasterData(db, soa, data);
        if (!result.ok) throw new Error(`Sample project ${sample.key} classification: ${result.message}`);
      }
    }

    if (!sample.plan) continue;
    const boq = await db.request.findUniqueOrThrow({ where: { submissionKey: `${idempotencyKey(sample.key)}:request` } });
    if (sample.plan === "BOQ_OPEN") {
      await pickPic(db, soa, boq.id, "SOA", "Adityo");
      continue;
    }
    await pickPic(db, soa, boq.id, "SOA", "Ibnu");
    await advance(db, soa, boq.id, "COMPLETED");
    const rfq = await handOverToPurchasing(db, owner ?? soa, { sourceId: boq.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(`Sample project ${sample.key} RFQ: ${rfq.message}`);
    await pickPic(db, purchasing, rfq.value.id, "PURCHASING", "Gita");
    if (sample.plan === "BOQ_DONE_RFQ_OPEN") continue;
    await advance(db, purchasing, rfq.value.id, "COMPLETED");
    const po = await handOverToPurchasing(db, owner ?? soa, { sourceId: rfq.value.id, targetType: "PO" });
    if (!po.ok) throw new Error(`Sample project ${sample.key} PO: ${po.message}`);
  }
  log(`sample projects: ${created} created, ${SAMPLE_PROJECTS.length - created} already there`);
  return { projects: SAMPLE_PROJECTS.length, created };
}
