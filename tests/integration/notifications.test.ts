import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { countUnread, listNotifications, markAllRead, markRead } from "@/server/notifications/service";
import { postProjectUpdate, updateCommercialDetails, updateProjectDetails } from "@/server/projects/service";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing, setRequestPhase } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

const base = () => ({ endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "CCTV AI" });
/**
 * A user's notifications, oldest first. Test files share one database and every PURCHASING or SOA user hears about
 * every request, so a test passes the codes of its own project and requests and sees only what is about them.
 */
async function mine(userId: string, ...codes: string[]) {
  const rows = await db.notification.findMany({ where: { recipientId: userId }, orderBy: { createdAt: "asc" } });
  return codes.length === 0 ? rows : rows.filter((row) => codes.some((code) => row.href.endsWith(`/${code}`)));
}

/** A Sales owner, an SOA user and a Purchasing user, plus a project with one BOQ request raised by the Sales owner. */
async function scene() {
  const sales = await actorOf("SALES");
  const soa = await actorOf("SOA");
  const purchasing = await actorOf("PURCHASING");
  const project = await createProject(db, sales, base());
  if (!project.ok) throw new Error(project.message);
  const boq = await createRequest(db, sales, { projectId: project.value.id, type: "BOQ", title: "BOQ for 40 cameras" });
  if (!boq.ok) throw new Error(boq.message);
  return { sales, soa, purchasing, project: project.value, boq: boq.value };
}

describe("requests reach the team that owns them", () => {
  it("tells SOA about a new BOQ and Purchasing about a new RFQ, never the requester", async () => {
    const { sales, soa, purchasing, project, boq } = await scene();

    expect((await mine(soa.id, boq.code)).map((n) => [n.kind, n.href])).toEqual([["request.created", `/request/${boq.code}`]]);
    expect(await mine(purchasing.id, boq.code)).toEqual([]); // a BOQ is not Purchasing's
    expect(await mine(sales.id)).toEqual([]);

    const rfq = await createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "Price for 10 servers" });
    expect(rfq.ok).toBe(true);
    const rfqCode = rfq.ok ? rfq.value.code : "";
    expect((await mine(purchasing.id, rfqCode)).map((n) => n.title)).toEqual([`New RFQ request ${rfqCode}`]);
    expect(await mine(soa.id, rfqCode)).toEqual([]); // an RFQ is not SOA's
  });

  it("a project created together with its request notifies the owning team in the same transaction", async () => {
    const sales = await actorOf("SALES");
    const purchasing = await actorOf("PURCHASING");

    const result = await createProject(db, sales, { ...base(), request: { type: "RFQ", title: "Price the cameras" } });

    expect(result.ok).toBe(true);
    const requestCode = result.ok ? (result.value.requestCode ?? "") : "";
    const rows = await mine(purchasing.id, requestCode);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "request.created", readAt: null });
    expect(rows[0]!.href).toBe(`/request/${requestCode}`);
  });

  it("tells Sales when SOA changes the status of their request, and asks for input when it is waiting", async () => {
    const { sales, soa, boq } = await scene();

    await changeRequestStatus(db, soa, { requestId: boq.id, to: "IN_PROGRESS" });
    await changeRequestStatus(db, soa, { requestId: boq.id, to: "WAITING_FOR_SALES", reason: "Which cabling standard?" });

    const rows = await mine(sales.id, boq.code);
    expect(rows.map((n) => n.title)).toEqual([`${boq.code} is now In progress`, `${boq.code} needs your input`]);
    expect(rows[1]!.body).toBe("Which cabling standard?");
    expect(await mine(soa.id, boq.code)).toHaveLength(1); // only the original arrival: SOA is not told about its own change
  });

  it("a handover tells Purchasing and the Sales requester", async () => {
    const { sales, soa, purchasing, boq } = await scene();
    await changeRequestStatus(db, soa, { requestId: boq.id, to: "IN_PROGRESS" });
    await changeRequestStatus(db, soa, { requestId: boq.id, to: "COMPLETED" });

    const handed = await handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ" });

    expect(handed.ok).toBe(true);
    const code = handed.ok ? handed.value.code : "";
    expect((await mine(purchasing.id, code)).map((n) => n.kind)).toEqual(["request.handed_over"]);
    expect((await mine(sales.id, code)).at(-1)).toMatchObject({ kind: "request.handed_over", href: `/request/${code}` });
  });
});

describe("project updates across divisions", () => {
  it("SOA's update reaches the Sales owner and the teams with an open request, not SOA itself", async () => {
    const { sales, soa, purchasing, project } = await scene();
    const rfq = await createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "Prices" });
    const rfqCode = rfq.ok ? rfq.value.code : "";
    const before = (await mine(soa.id, project.code)).length;

    const posted = await postProjectUpdate(db, soa, { projectId: project.id, kind: "CURRENT", body: "Sizing done" });
    const edited = await updateProjectDetails(db, soa, { projectId: project.id, values: { sizingStatus: "Done" } });

    expect(posted.ok && edited.ok).toBe(true);
    expect((await mine(sales.id, project.code)).map((n) => n.title)).toEqual([`${project.code} current action updated`, `${project.code} technical details updated`]);
    expect((await mine(purchasing.id, rfqCode, project.code)).map((n) => n.kind)).toEqual(["request.created", "project.updated", "project.updated"]); // the open RFQ is theirs
    expect(await mine(soa.id, project.code)).toHaveLength(before);
  });

  it("Sales' commercial change reaches the technical PIC and the SOA team with an open BOQ", async () => {
    const { sales, soa, project } = await scene();
    const pic = await actorOf("SOA");
    await db.project.update({ where: { id: project.id }, data: { technicalPicId: pic.id } });

    await updateCommercialDetails(db, sales, { projectId: project.id, values: { targetMargin: "12" } });

    const picRows = await mine(pic.id, project.code);
    expect(picRows.at(-1)).toMatchObject({ kind: "project.updated", title: `${project.code} commercial details updated`, href: `/projects/${project.code}` });
    expect((await mine(soa.id, project.code)).at(-1)?.kind).toBe("project.updated");
    expect((await mine(sales.id, project.code)).filter((n) => n.kind === "project.updated")).toEqual([]);
  });

  it("a change that changes nothing notifies nobody", async () => {
    const { sales, soa, project } = await scene();
    const before = (await mine(soa.id, project.code)).length;

    await updateCommercialDetails(db, sales, { projectId: project.id, values: { progress: "QUALIFY" } });

    expect(await mine(soa.id, project.code)).toHaveLength(before);
  });
});

describe("SOA phase", () => {
  it("SOA labels a BOQ; the project's people are told and the change is audited", async () => {
    const { sales, soa, boq } = await scene();

    const result = await setRequestPhase(db, soa, { requestId: boq.id, phase: "SIZING" });

    expect(result).toEqual({ ok: true, value: { code: boq.code } });
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ phase: "SIZING" });
    expect((await mine(sales.id, boq.code)).at(-1)).toMatchObject({ kind: "request.phase_changed", title: `${boq.code} is now in Sizing` });
    await expect(db.auditEvent.count({ where: { action: "request.phase_changed", entityId: boq.id, actorId: soa.id } })).resolves.toBe(1);

    const again = await setRequestPhase(db, soa, { requestId: boq.id, phase: "SIZING" }); // no change, no second notification
    expect(again.ok).toBe(true);
    expect((await mine(sales.id, boq.code)).filter((n) => n.kind === "request.phase_changed")).toHaveLength(1);

    await setRequestPhase(db, soa, { requestId: boq.id, phase: "" });
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ phase: null });
  });

  it("only BOQ people may label, only a BOQ, only while it is open", async () => {
    const { sales, soa, purchasing, project, boq } = await scene();
    const rfq = await createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "Prices" });
    if (!rfq.ok) throw new Error(rfq.message);

    for (const actor of [sales, purchasing]) {
      await expect(setRequestPhase(db, actor, { requestId: boq.id, phase: "POC" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(setRequestPhase(db, soa, { requestId: rfq.value.id, phase: "POC" })).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
    await expect(setRequestPhase(db, soa, { requestId: boq.id, phase: "DEPLOYMENT" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await changeRequestStatus(db, soa, { requestId: boq.id, to: "CANCELLED", reason: "Customer cancelled" });
    await expect(setRequestPhase(db, soa, { requestId: boq.id, phase: "POC" })).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ phase: null });
  });

  it("the database keeps a phase off RFQ and PO requests", async () => {
    const { sales, project } = await scene();
    const rfq = await createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "Prices" });
    if (!rfq.ok) throw new Error(rfq.message);

    await expect(db.request.update({ where: { id: rfq.value.id }, data: { phase: "SIZING" } })).rejects.toThrow(/requests_phase_boq_only_chk/);
  });
});

describe("reading notifications", () => {
  it("lists only the user's own, counts the unread, and marks one or all as read", async () => {
    const { sales, soa, project } = await scene();
    await postProjectUpdate(db, soa, { projectId: project.id, kind: "NEXT", body: "Visit the site" });
    await postProjectUpdate(db, soa, { projectId: project.id, kind: "CURRENT", body: "Site visited" });

    const list = await listNotifications(db, sales.id);
    expect(list).toHaveLength(2);
    expect(list[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(list[1]!.createdAt.getTime()); // newest first
    expect(await countUnread(db, sales.id)).toBe(2);

    await markRead(db, soa.id, list[0]!.id); // someone else's id changes nothing
    expect(await countUnread(db, sales.id)).toBe(2);
    await markRead(db, sales.id, list[0]!.id);
    expect(await countUnread(db, sales.id)).toBe(1);
    expect(await markAllRead(db, sales.id)).toBe(1);
    expect(await countUnread(db, sales.id)).toBe(0);
  });
});
