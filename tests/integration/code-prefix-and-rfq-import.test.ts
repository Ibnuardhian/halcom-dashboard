import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { parseRfqTickets } from "@/server/import/rfq-tickets";
import { importRfqTickets, planFromDatabase } from "@/server/import/rfq-tickets-db";
import { changeRequestStatus, createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const HEADER = "TicketID,Tanggal Masuk,Tanggal Response,Pengirim,Customer,Project,Status,PIC,Catatan,LinkEmail,MessageID,CoversationID";

describe("request code prefixes", () => {
  /** A Sales user whose address starts with the same unusual letters, so they compete for the same prefix. */
  async function sameLetterUsers(count: number) {
    const stem = `q${randomBytes(6).toString("hex")}`;
    return Promise.all(Array.from({ length: count }, (_, i) => makeUser("SALES", { email: `${stem}${"abc"[i]}.person@example.invalid` })));
  }
  const raise = async (user: { id: string; role: Role }, label: string) => {
    const made = await createProject(db, { id: user.id, role: user.role }, { endUserCompany: `Prefix ${label}`, name: `prefix ${label}`, request: { type: "RFQ", title: `RFQ ${label}` } });
    if (!made.ok) throw new Error(made.message);
    const request = await db.request.findFirstOrThrow({ where: { projectId: made.value.id } });
    return request.code;
  };
  const prefixOf = (code: string) => code.split("-")[1]!;

  it("gives a person one letter, keeps it for every later request, and gives a second person with the same letter more letters", async () => {
    const [first, second] = await sameLetterUsers(2);

    const a1 = await raise(first!, "a1");
    const a2 = await raise(first!, "a2");
    const b1 = await raise(second!, "b1");

    expect(prefixOf(a1)).toBe(prefixOf(a2));
    expect(prefixOf(a1)).toMatch(/^Q[A-Z0-9]{0,2}$/);
    expect(prefixOf(b1)).not.toBe(prefixOf(a1));
    // The first person to ask took the shortest free prefix: the second's is longer or equal, and starts with the same letter.
    expect(prefixOf(b1).startsWith("Q")).toBe(true);
    expect(prefixOf(b1).length).toBeGreaterThanOrEqual(prefixOf(a1).length);
    // Numbers continue per prefix.
    expect(Number(a2.slice(-4))).toBe(Number(a1.slice(-4)) + 1);
    expect((await db.user.findUniqueOrThrow({ where: { id: first!.id } })).codePrefix).toBe(prefixOf(a1));
  });

  it("never gives two people who ask at the same moment the same prefix", async () => {
    const people = await sameLetterUsers(3);

    const codes = await Promise.all(people.map((person, i) => raise(person, `race${i}`)));

    expect(new Set(codes.map(prefixOf)).size).toBe(3);
    const stored = await db.user.findMany({ where: { id: { in: people.map((p) => p.id) } }, select: { codePrefix: true } });
    expect(new Set(stored.map((s) => s.codePrefix)).size).toBe(3);
  });

  it("only accepts prefixes a code can hold: at most three characters, letters first", async () => {
    const user = await makeUser("SALES");
    for (const bad of ["abc", "ABCD", "1A", "A-B", ""]) {
      await expect(db.user.update({ where: { id: user.id }, data: { codePrefix: bad } })).rejects.toThrow(/users_code_prefix_chk/);
    }
    await expect(db.user.update({ where: { id: user.id }, data: { codePrefix: null } })).resolves.toBeTruthy();
  });

  it("records the first answer once, when the request is first taken up or completed", async () => {
    const sales = await makeUser("SALES");
    const code = await raise(sales, "answer");
    const request = await db.request.findUniqueOrThrow({ where: { code } });
    expect(request.respondedAt).toBeNull();
    // An RFQ is worked by Purchasing.
    const purchasing = await makeUser("PURCHASING");

    await changeRequestStatus(db, { id: purchasing.id, role: "PURCHASING" }, { requestId: request.id, to: "IN_PROGRESS" });
    const first = (await db.request.findUniqueOrThrow({ where: { code } })).respondedAt;
    await changeRequestStatus(db, { id: purchasing.id, role: "PURCHASING" }, { requestId: request.id, to: "COMPLETED" });

    expect(first).not.toBeNull();
    expect((await db.request.findUniqueOrThrow({ where: { code } })).respondedAt).toEqual(first);
  });
});

describe("RFQ ticket import", () => {
  /** Synthetic rows, never the real sheet: the customer names are unique per run, the senders are the mapped development accounts. */
  function sheet(tag: string) {
    return [
      HEADER,
      `,2026-10-06,2026-10-07,satrio.akbar@example.test,Cust A ${tag},Project A ${tag},Done,Gita,,https://example.test/a,<a-${tag}@x>,conv-a`,
      `,2026-10-07,,gusti.nirmala@example.test,Cust B ${tag},Project B ${tag},Failed,Soraya,No quote in time,,<b-${tag}@x>,`,
      `,2026-10-08,2026-10-09,satrio.akbar@example.test,Cust C ${tag},Project C ${tag},On Going,Gita & Soraya,Waiting for photo,,<c-${tag}@x>,`,
      `,2026-10-09,,adityo.prabowo@example.test,Cust D ${tag},Project D ${tag},Baru,,,,<d-${tag}@x>,`,
    ].join("\n");
  }
  const planFor = async (tag: string) => {
    const { rows, problems } = parseRfqTickets(sheet(tag));
    expect(problems).toEqual([]);
    const { plan, problems: planProblems } = await planFromDatabase(db, rows, `test sheet ${tag}`);
    expect(planProblems).toEqual([]);
    return plan!;
  };

  async function ensureAccounts() {
    // The importer needs the accounts that `db:seed` creates (it never creates a working account itself).
    for (const [email, role] of [["purchasing@example.invalid", "PURCHASING"], ["superadmin@example.invalid", "SUPERADMIN"], ["satrio@example.invalid", "SALES"]] as const) {
      if (!(await db.user.findUnique({ where: { email } }))) await makeUser(role, { email });
    }
  }

  it("adds the requests with their history, PIC, e-mail ids and projects; a second run adds nothing", async () => {
    await ensureAccounts();
    const tag = randomBytes(3).toString("hex");
    const plan = await planFor(tag);

    const dry = await importRfqTickets(db, plan, { dryRun: true });
    expect(dry.requestsToCreate).toHaveLength(4);
    expect(await db.request.count({ where: { importedFrom: `test sheet ${tag}` } })).toBe(0);

    const summary = await importRfqTickets(db, plan, { fileName: `test sheet ${tag}` });
    expect(summary.requestsToCreate).toHaveLength(4);

    const requests = await db.request.findMany({
      where: { importedFrom: `test sheet ${tag}` },
      orderBy: { createdAt: "asc" },
      include: { pic: true, requester: true, project: { include: { salesOwner: true } }, statusHistory: { orderBy: { changedAt: "asc" } }, picAssignments: true },
    });
    expect(requests.map((r) => r.status)).toEqual(["COMPLETED", "CANCELLED", "IN_PROGRESS", "SUBMITTED"]);
    for (const request of requests) expect(request.code).toMatch(/^RFQ-[A-Z0-9]{1,3}-26\d{4}$/);
    const [done, failed, going, fresh] = requests;
    expect(done).toMatchObject({ emailLink: "https://example.test/a", emailMessageId: `<a-${tag}@x>`, emailConversationId: "conv-a", pic: { name: "Gita" } });
    expect(done!.respondedAt).toEqual(new Date("2026-10-07T08:00:00Z"));
    expect(done!.completedAt).toEqual(new Date("2026-10-07T08:00:00Z"));
    expect(done!.statusHistory.map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, "SUBMITTED"], ["SUBMITTED", "COMPLETED"]]);
    expect(failed!.statusHistory.at(-1)).toMatchObject({ toStatus: "CANCELLED", reason: "No quote in time" });
    expect(failed!.completedAt).toBeNull();
    expect(going!.pic?.name).toBe("Gita"); // "Gita & Soraya": the first is assigned
    expect(going!.description).toContain("Gita & Soraya");
    expect(going!.picAssignments).toHaveLength(1);
    expect(fresh!.statusHistory).toHaveLength(1);
    expect(fresh!.pic).toBeNull();
    // Gusti's projects belong to Satrio; an SOA sender's project has no Sales PIC.
    expect(failed!.requester.email).toBe("gusti@example.invalid");
    expect(failed!.project.salesOwner?.email).toBe("satrio@example.invalid");
    expect(fresh!.project).toMatchObject({ sourceType: "OTHER", salesOwnerId: null, externalSourceName: "Adityo Prabowo" });

    // The counters continue after the imported numbers, so the next new request does not collide.
    const counter = await db.codeCounter.findUniqueOrThrow({ where: { scope: `RFQ-${done!.code.split("-")[1]}-26` } });
    expect(counter.lastValue).toBeGreaterThanOrEqual(Number(done!.code.slice(-4)));

    const again = await importRfqTickets(db, await planFor(tag), { fileName: `test sheet ${tag}` });
    expect(again.requestsToCreate).toHaveLength(0);
    expect(again.requestsExisting).toHaveLength(4);
    expect(await db.request.count({ where: { importedFrom: `test sheet ${tag}` } })).toBe(4);
  });

  it("writes nothing when a step fails", async () => {
    await ensureAccounts();
    const tag = randomBytes(3).toString("hex");
    const plan = await planFor(tag);
    const projectsBefore = await db.project.count({ where: { importedFrom: `test sheet ${tag}` } });

    await expect(
      importRfqTickets(db, plan, { fileName: `test sheet ${tag}` }, { onStep: (step) => { if (step === "requests") throw new Error("boom"); } }),
    ).rejects.toThrow("boom");

    expect(await db.request.count({ where: { importedFrom: `test sheet ${tag}` } })).toBe(0);
    expect(await db.project.count({ where: { importedFrom: `test sheet ${tag}` } })).toBe(projectsBefore);
    expect(await db.customer.count({ where: { name: { contains: tag } } })).toBe(0);
  });
});
