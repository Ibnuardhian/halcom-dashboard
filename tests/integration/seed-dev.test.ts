import { afterAll, describe, expect, it } from "vitest";
import { SEED_KEY_PREFIX } from "@/domain/devdata/test-data";
import { getDb } from "@/lib/db";
import { DEV_PICS, DEV_PRINCIPALS, DEV_SALES_ACCOUNTS, DEV_SOLUTIONS, SAMPLE_PROJECTS, seedAccounts, seedMasterDataAndPics, seedSampleDataset } from "@/server/devdata/seed-dev";
import { TEST_PASSWORD } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

/** Every table the seeders write to, as counts, so a second run can be compared with the first. */
async function snapshot() {
  const keyed = { submissionKey: { startsWith: SEED_KEY_PREFIX } };
  return {
    users: await db.user.count({ where: { email: { in: [...DEV_SALES_ACCOUNTS.map((a) => a.email), "admin@halcominovasi.co.id", "support@halcominovasi.co.id", "purchasing@halcominovasi.co.id"] } } }),
    principals: await db.principal.count({ where: { name: { in: [...DEV_PRINCIPALS] } } }),
    solutions: await db.solutionCategory.count({ where: { name: { in: [...DEV_SOLUTIONS] } } }),
    pics: await db.pic.count({ where: { name: { in: DEV_PICS.map((pic) => pic.name) } } }),
    projects: await db.project.count({ where: keyed }),
    requests: await db.request.count({ where: keyed }),
    allRequestsOfSamples: await db.request.count({ where: { project: keyed } }),
    history: await db.requestStatusHistory.count({ where: { request: { project: keyed } } }),
    audit: await db.auditEvent.count({ where: { entityType: { in: ["project", "request"] }, entityId: { in: (await db.project.findMany({ where: keyed, select: { id: true } })).map((p) => p.id) } } }),
  };
}

describe("development seed", () => {
  it("creates the accounts, master data, PICs and sample dataset, and a second run adds nothing", async () => {
    const first = await seedAccounts(db, TEST_PASSWORD);
    // One account per role except Sales (whose role account is one of the Sales people), plus the two Sales people.
    expect(first.total).toBe(6 + DEV_SALES_ACCOUNTS.length);
    await seedMasterDataAndPics(db, "admin@halcominovasi.co.id");
    await seedSampleDataset(db);
    const afterFirst = await snapshot();

    expect(afterFirst).toMatchObject({ users: 5, principals: DEV_PRINCIPALS.length, solutions: DEV_SOLUTIONS.length, pics: DEV_PICS.length, projects: SAMPLE_PROJECTS.length });

    const second = await seedAccounts(db, TEST_PASSWORD);
    await seedMasterDataAndPics(db, "admin@halcominovasi.co.id");
    const sample = await seedSampleDataset(db);

    expect(second.created).toBe(0);
    expect(sample.created).toBe(0);
    expect(await snapshot()).toEqual(afterFirst);
  });

  it("builds a relationally valid dataset: owners, source, classification, PICs and the BOQ -> RFQ -> PO chain", async () => {
    await seedAccounts(db, TEST_PASSWORD);
    await seedMasterDataAndPics(db, "admin@halcominovasi.co.id");
    await seedSampleDataset(db);

    const projects = await db.project.findMany({
      where: { submissionKey: { startsWith: SEED_KEY_PREFIX } },
      include: { salesOwner: { select: { email: true } }, requests: { orderBy: { createdAt: "asc" }, include: { pic: { select: { name: true, team: true } } } }, principals: true },
      orderBy: { submissionKey: "asc" },
    });

    const byKey = Object.fromEntries(projects.map((project) => [project.submissionKey!.slice(SEED_KEY_PREFIX.length), project]));
    expect(byKey["p1"]).toMatchObject({ sourceType: "INTERNAL_SALES", salesOwner: { email: "dzaki@halcominovasi.co.id" } });
    expect(byKey["p1"]?.requests.map((r) => [r.type, r.status])).toEqual([["BOQ", "SUBMITTED"]]);
    expect(byKey["p2"]?.requests.map((r) => [r.type, r.status])).toEqual([["BOQ", "COMPLETED"], ["RFQ", "IN_PROGRESS"]]);
    expect(byKey["p3"]?.requests.map((r) => [r.type, r.status])).toEqual([["BOQ", "COMPLETED"], ["RFQ", "COMPLETED"], ["PO", "IN_PROGRESS"]]);
    // A project from an outside source has no Sales PIC and keeps the external name.
    expect(byKey["p4"]).toMatchObject({ sourceType: "OTHER", salesOwnerId: null, externalSourceName: "Partner Reseller Example" });
    expect(byKey["p5"]?.requests).toHaveLength(0);
    // PICs belong to the team that works the request type.
    for (const request of projects.flatMap((project) => project.requests)) {
      if (request.pic) expect(request.pic.team).toBe(request.type === "BOQ" ? "SOA" : "PURCHASING");
    }
    expect(byKey["p2"]?.requests[1]?.sourceRequestId).toBe(byKey["p2"]?.requests[0]?.id);
    expect(byKey["p3"]?.principals.length).toBe(1);
    // The sample customers are fictional and never look like the placeholders the test-data cleanup removes.
    const customers = await db.customer.findMany({ where: { projects: { some: { submissionKey: { startsWith: SEED_KEY_PREFIX } } } }, select: { name: true } });
    for (const customer of customers) expect(customer.name).not.toMatch(/^PT [A-Z]{4}$/);
  });

  it("does not overwrite what someone changed in the application", async () => {
    await seedAccounts(db, TEST_PASSWORD);
    await seedMasterDataAndPics(db, "admin@halcominovasi.co.id");
    await seedSampleDataset(db);
    const project = await db.project.findFirstOrThrow({ where: { submissionKey: `${SEED_KEY_PREFIX}p5` } });
    await db.project.update({ where: { id: project.id }, data: { name: "Renamed in the app" } });
    await db.user.update({ where: { email: "dzaki@halcominovasi.co.id" }, data: { name: "Dzaki Renamed" } });

    await seedAccounts(db, TEST_PASSWORD);
    await seedSampleDataset(db);

    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).name).toBe("Renamed in the app");
    expect((await db.user.findUniqueOrThrow({ where: { email: "dzaki@halcominovasi.co.id" } })).name).toBe("Dzaki Renamed");
    await db.user.update({ where: { email: "dzaki@halcominovasi.co.id" }, data: { name: "Dzaki" } });
  });

  it("explains itself when the accounts are missing", async () => {
    await expect(seedMasterDataAndPics(db, "nobody-admin@halcominovasi.co.id")).rejects.toThrow(/db:seed/);
  });
});
