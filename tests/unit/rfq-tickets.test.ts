import { describe, expect, it } from "vitest";
import { parseRfqTickets, planRfqImport, splitPics, stepsOf, ticketKey, type TicketRow } from "@/server/import/rfq-tickets";
import { renderRfqSql, sqlText } from "@/server/import/rfq-tickets-sql";

const HEADER = "TicketID,Tanggal Masuk,Tanggal Response,Pengirim,Customer,Project,Status,PIC,Catatan,LinkEmail,MessageID,CoversationID";
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

const rows = (...lines: string[]): TicketRow[] => {
  const parsed = parseRfqTickets(csv(...lines));
  expect(parsed.problems).toEqual([]);
  return parsed.rows;
};

describe("reading the tracker sheet", () => {
  it("reads a row, trims names and pads the cells the sheet leaves out", () => {
    const [row] = rows(",2026-10-12,2026-10-13,Satrio.Akbar@example.test,Apotek Alpro ,Zebra TC22,Done,Gita & Soraya");

    expect(row).toMatchObject({ ticketId: null, entryDate: "2026-10-12", responseDate: "2026-10-13", senderEmail: "satrio.akbar@example.test", customer: "Apotek Alpro", statusLabel: "Done", pics: ["Gita", "Soraya"], note: null });
  });

  it("keeps no mail link or conversation id: only the Message-ID is read, to give the ticket a stable key", () => {
    const [row] = rows(",2026-10-12,2026-10-13,satrio.akbar@example.test,C,P,Done,Gita,,https://mail.example.test/x,<m1@x>,conv-1");

    expect(row).not.toHaveProperty("emailLink");
    expect(row).not.toHaveProperty("conversationId");
    expect(row!.messageId).toBe("<m1@x>");
  });

  it("splits more than one PIC", () => {
    expect(splitPics("Gita & Soraya")).toEqual(["Gita", "Soraya"]);
    expect(splitPics("Gita, Soraya")).toEqual(["Gita", "Soraya"]);
    expect(splitPics("")).toEqual([]);
    expect(splitPics(null)).toEqual([]);
  });

  it("lists every problem of the file at once", () => {
    const { problems } = parseRfqTickets(
      csv(
        ",2026-13-01,,a@example.test,C,P,Done,,,,",
        ",2026-10-12,2026-10-10,a@example.test,C,P,Done,,,,",
        ",2026-10-12,,a@example.test,C,P,Maybe,,,,",
        ",2026-10-12,,not-an-address,C,P,Done,,,,",
        ",2026-10-12,,a@example.test,,P,Done,,,,",
        "XYZ-1,2026-10-12,,a@example.test,C,P,Done,,,,",
      ),
    );

    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Line 2: "Tanggal Masuk"'),
        expect.stringContaining("Line 3: the response is dated before"),
        expect.stringContaining('Line 4: status "Maybe"'),
        expect.stringContaining("Line 5:"),
        expect.stringContaining('Line 6: "Customer" is empty'),
        expect.stringContaining('Line 7: ticket id "XYZ-1"'),
      ]),
    );
  });

  it("refuses a file without the expected columns", () => {
    expect(parseRfqTickets("a,b\n1,2").problems[0]).toMatch(/has no column/);
  });
});

describe("the status moves of a ticket", () => {
  const T = (iso: string) => new Date(iso);

  it("makes the response date the move to In progress, and the outcome follows the same day", () => {
    expect(stepsOf({ entryDate: "2026-10-06", responseDate: "2026-10-07", note: null }, "COMPLETED")).toEqual([
      { from: "SUBMITTED", to: "IN_PROGRESS", at: T("2026-10-07T08:00:00Z"), reason: null },
      { from: "IN_PROGRESS", to: "COMPLETED", at: T("2026-10-07T10:00:00Z"), reason: null },
    ]);
  });

  it("keeps the note as the reason of the last move, and a cancellation goes through In progress when the team answered", () => {
    expect(stepsOf({ entryDate: "2026-10-06", responseDate: "2026-10-08", note: "No quote in time" }, "CANCELLED")).toEqual([
      { from: "SUBMITTED", to: "IN_PROGRESS", at: T("2026-10-08T08:00:00Z"), reason: null },
      { from: "IN_PROGRESS", to: "CANCELLED", at: T("2026-10-08T10:00:00Z"), reason: "No quote in time" },
    ]);
  });

  it("moves a ticket without a response date straight to its outcome on the day it came in", () => {
    expect(stepsOf({ entryDate: "2026-10-06", responseDate: null, note: "No quote in time" }, "CANCELLED")).toEqual([
      { from: "SUBMITTED", to: "CANCELLED", at: T("2026-10-06T10:00:00Z"), reason: "No quote in time" },
    ]);
    expect(stepsOf({ entryDate: "2026-10-06", responseDate: null, note: null }, "IN_PROGRESS")).toEqual([{ from: "SUBMITTED", to: "IN_PROGRESS", at: T("2026-10-06T10:00:00Z"), reason: null }]);
  });

  it("leaves an open ticket with the one move to In progress, whose reason is the note", () => {
    expect(stepsOf({ entryDate: "2026-10-06", responseDate: "2026-10-09", note: "Waiting for photo" }, "IN_PROGRESS")).toEqual([
      { from: "SUBMITTED", to: "IN_PROGRESS", at: T("2026-10-09T08:00:00Z"), reason: "Waiting for photo" },
    ]);
    expect(stepsOf({ entryDate: "2026-10-06", responseDate: null, note: null }, "SUBMITTED")).toEqual([]);
  });
});

describe("planning the import", () => {
  const plan = (lines: string[], context = {}) => {
    const result = planRfqImport(rows(...lines), context);
    expect(result.problems).toEqual([]);
    return result.plan!;
  };

  it("gives each sender one letter and numbers their tickets from 1 in date order", () => {
    const p = plan([
      ",2026-10-08,2026-10-08,dzaki@example.test,C2,P2,Done,Soraya,,,m2",
      ",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1",
      ",2026-10-07,2026-10-07,satrio.akbar@example.test,C3,P3,Done,Gita,,,m3",
    ]);

    expect(p.tickets.map((t) => [t.code, t.requesterEmail])).toEqual([
      ["RFQ-S-260001", "satrio@halcominovasi.co.id"],
      ["RFQ-S-260002", "satrio@halcominovasi.co.id"],
      ["RFQ-D-260001", "dzaki@halcominovasi.co.id"],
    ]);
    expect(Object.fromEntries(p.prefixes.map((x) => [x.email, x.prefix]))).toEqual({ "satrio@halcominovasi.co.id": "S", "dzaki@halcominovasi.co.id": "D" });
  });

  it("raises a SOA person's tickets through the shared SOA login and records the person as a SOA PIC", () => {
    const p = plan([
      ",2026-10-06,2026-10-07,satrio.akbar@example.test,C0,P0,Done,Gita,,,m0",
      ",2026-10-15,2026-10-15,ibnu.ardhiansyah@example.test,C1,P1,Done,Gita,,,m1",
      "RFQ-A-260002,2026-10-20,,adityo.prabowo@example.test,C2,P2,Baru,,,,m2",
    ]);
    const ibnu = p.tickets.find((t) => t.title === "P1")!;
    const adityo = p.tickets.find((t) => t.title === "P2")!;

    expect(ibnu).toMatchObject({ requesterEmail: "support@halcominovasi.co.id", raisedByPic: "Ibnu" });
    expect(adityo).toMatchObject({ requesterEmail: "support@halcominovasi.co.id", raisedByPic: "Adityo", code: "RFQ-A-260002" });
    // The login's own letter is taken the way anyone's is: "S" is Satrio's, so the SOA login gets two letters.
    expect(ibnu.code).toBe("RFQ-SO-260001");
    expect(p.prefixes.find((x) => x.email === "support@halcominovasi.co.id")?.prefix).toBe("SO");
    // The sheet's own code stays as written and its number is kept, but the shared login does not take the letter "A".
    expect(p.counters.find((c) => c.scope === "RFQ-A-26")?.last).toBe(2);
    expect(p.prefixes.some((x) => x.prefix === "A")).toBe(false);
    expect(p.pics.filter((x) => x.team === "SOA").map((x) => x.name).sort()).toEqual(["Adityo", "Ibnu"]);
    // Their projects have no Sales PIC and no Sales name: the person is the project's Technical PIC (SOA).
    expect(p.projects.find((x) => x.name === "P1")).toMatchObject({ ownerEmail: null, externalSourceName: "Internal SOA request", technicalPicEmail: "support@halcominovasi.co.id" });
    expect(p.projects.find((x) => x.name === "P2")).toMatchObject({ ownerEmail: null, externalSourceName: "Internal SOA request", technicalPicEmail: "support@halcominovasi.co.id" });
    expect(JSON.stringify(p.projects)).not.toMatch(/Ibnu"|Adityo"/); // neither name is written as a Sales name
    // Nobody is created just for history: every account the plan names already exists (the shared SOA login holds the Technical PIC column).
    expect(p.accounts.filter((a) => a.historyOnly)).toEqual([]);
    expect(p.accounts.map((a) => a.email).sort()).toEqual(["satrio@halcominovasi.co.id", "support@halcominovasi.co.id"]);
  });

  it("keeps the ticket ids the sheet already has, decides the sender's letter from them, and numbers on from them", () => {
    const p = plan(["RFQ-S-260003,2026-10-15,2026-10-15,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1", ",2026-10-20,,satrio.akbar@example.test,C2,P2,Baru,,,,m2"]);

    expect(p.tickets.map((t) => t.code)).toEqual(["RFQ-S-260003", "RFQ-S-260004"]);
    expect(p.counters.find((c) => c.scope === "RFQ-S-26")?.last).toBe(4);
    expect(p.prefixes).toEqual([{ email: "satrio@halcominovasi.co.id", prefix: "S" }]);
  });

  it("gives a second person with the same letter their first two letters, and continues after what exists", () => {
    const p = plan(
      [",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1", ",2026-10-06,2026-10-07,ibnu.ardhiansyah@example.test,C2,P2,Done,Gita,,,m2"],
      { existingPrefixes: new Map([["dzaki@halcominovasi.co.id", "D"]]), existingCounters: new Map([["RFQ-S-26", 4]]) },
    );

    // "S" is Satrio's, so the SOA login gets its first two letters.
    expect(p.tickets.map((t) => t.code)).toEqual(["RFQ-S-260005", "RFQ-SO-260001"]);
  });

  it("maps the sheet's statuses and writes the moves", () => {
    const p = plan([
      ",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1",
      ",2026-10-06,,satrio.akbar@example.test,C2,P2,Failed,Soraya,No quote in time,,m2",
      ",2026-10-06,2026-10-08,satrio.akbar@example.test,C3,P3,On Going,Gita,Waiting for photo,,m3",
      ",2026-10-06,,satrio.akbar@example.test,C4,P4,Baru,,,,m4",
    ]);
    const by = Object.fromEntries(p.tickets.map((t) => [t.title, t]));

    expect(by["P1"]).toMatchObject({ status: "COMPLETED", completedAt: new Date("2026-10-07T10:00:00Z") });
    expect(by["P1"]?.steps.map((s) => s.to)).toEqual(["IN_PROGRESS", "COMPLETED"]);
    expect(by["P2"]).toMatchObject({ status: "CANCELLED", completedAt: null });
    expect(by["P2"]?.steps.at(-1)).toMatchObject({ to: "CANCELLED", reason: "No quote in time" });
    expect(by["P3"]).toMatchObject({ status: "IN_PROGRESS", completedAt: null });
    expect(by["P3"]?.steps).toHaveLength(1);
    expect(by["P4"]).toMatchObject({ status: "SUBMITTED", steps: [], picName: null });
    // The ticket came in at 09:00 Jakarta time.
    expect(by["P1"]?.createdAt).toEqual(new Date("2026-10-06T02:00:00Z"));
  });

  it("makes one project per customer and project, owned as D-031 says: Gusti's go to Satrio", () => {
    const p = plan([
      ",2026-10-06,2026-10-07,gusti.nirmala@example.test,C1,P1,Done,Gita,,,m1",
      ",2026-10-07,2026-10-07,adityo.prabowo@example.test,C2,P2,Done,Gita,,,m2",
      ",2026-10-08,2026-10-08,satrio.akbar@example.test,C1,P1,Done,Gita,,,m3",
    ]);

    expect(p.projects).toHaveLength(2);
    expect(p.projects.find((x) => x.name === "P1")).toMatchObject({ ownerEmail: "satrio@halcominovasi.co.id", externalSourceName: null });
    expect(p.tickets.filter((t) => t.projectKey === p.projects.find((x) => x.name === "P1")!.key)).toHaveLength(2);
  });

  it("assigns the first PIC when two are named and keeps the whole text", () => {
    const p = plan([",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita & Soraya,,,m1"]);

    expect(p.tickets[0]).toMatchObject({ picName: "Gita", picNames: ["Gita", "Soraya"] });
    expect(p.tickets[0]?.description).toContain("PIC in the tracker: Gita & Soraya.");
    expect(p.pics.filter((x) => x.team === "PURCHASING").map((x) => x.name)).toEqual(["Gita", "Soraya"]);
  });

  it("stops on a sender nobody mapped, and on the same ticket twice", () => {
    expect(planRfqImport(rows(",2026-10-06,,stranger@example.test,C1,P1,Done,Gita,,,m1")).problems[0]).toMatch(/not mapped to an account/);
    const twice = planRfqImport(rows(",2026-10-06,,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1", ",2026-10-07,,satrio.akbar@example.test,C2,P2,Done,Gita,,,m1"));
    expect(twice.problems[0]).toMatch(/same ticket twice/);
  });

  it("refuses a sheet code whose letter belongs to somebody else", () => {
    const result = planRfqImport(rows("RFQ-S-260002,2026-10-20,,satrio.akbar@example.test,C,P,Baru,,,,m1"), { existingPrefixes: new Map([["dzaki@halcominovasi.co.id", "S"]]) });

    expect(result.problems[0]).toMatch(/belongs to someone else/);
  });

  it("keeps the code a ticket already has while it fits its prefix, and gives a new number of the new prefix when the requester changed", () => {
    const lines = [",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1", ",2026-10-15,2026-10-15,ibnu.ardhiansyah@example.test,C2,P2,Done,Gita,,,m2"];
    const [first, second] = rows(...lines);
    const p = plan(lines, {
      existingPrefixes: new Map([["satrio@halcominovasi.co.id", "S"]]),
      // The counters are far ahead of the kept codes: the kept code must not move, and the new one continues after the counter.
      existingCounters: new Map([["RFQ-S-26", 19], ["RFQ-SO-26", 1]]),
      existingCodes: new Map([[ticketKey(first!), "RFQ-S-260004"], [ticketKey(second!), "RFQ-I-260001"]]),
    });

    expect(p.tickets.map((t) => [t.title, t.code])).toEqual([["P1", "RFQ-S-260004"], ["P2", "RFQ-SO-260002"]]);
  });

  it("gives a ticket the same key every time", () => {
    const [a] = rows(",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1");
    expect(ticketKey(a!)).toBe(ticketKey({ ...a!, line: 99 }));
    expect(ticketKey(a!)).not.toBe(ticketKey({ ...a!, messageId: "m2" }));
  });
});

describe("the SQL file", () => {
  const plan = planRfqImport(
    rows(
      ",2026-10-06,2026-10-07,satrio.akbar@example.test,O'Neil Co,\"Kabel; DROP TABLE users; --\",Done,Gita,It's done,https://example.test/a?b=1,<m@x>,c1",
      ",2026-10-08,2026-10-09,ibnu.ardhiansyah@example.test,C2,P2,On Going,Soraya,Waiting,,<n@x>,",
    ),
  ).plan!;
  const sql = (transaction?: boolean) => renderRfqSql(plan, { lockedPasswordHash: "scrypt$locked", generatedAt: new Date("2026-10-20T00:00:00Z"), transaction });

  it("quotes every value, so a name cannot end the string", () => {
    expect(sqlText("O'Neil")).toBe("'O''Neil'");
    expect(sqlText(null)).toBe("NULL");
    expect(() => sqlText("a\u0000b")).toThrow();
    const text = sql();
    expect(text).toContain("'O''Neil Co'");
    expect(text).toContain("'Kabel; DROP TABLE users; --'");
    expect(text).toContain("'It''s done'");
  });

  it("runs in one transaction by default, and only adds", () => {
    const text = sql();

    expect(text).toMatch(/^BEGIN;$/m);
    expect(text).toMatch(/^COMMIT;$/m);
    expect(sql(false)).not.toMatch(/^BEGIN;$/m);
    expect(text).not.toMatch(/^\s*(DELETE|TRUNCATE|DROP)\b/im);
    expect(text).toContain("ON CONFLICT (team, name_key) DO NOTHING");
    expect(text).not.toMatch(/INSERT INTO users \(/); // every account already exists: the file creates none
    expect(text).toContain("WHERE NOT EXISTS (SELECT 1 FROM requests r WHERE r.submission_key = s.ticket_key)");
  });

  it("carries the planned code, the prefix, the status moves and the SOA PIC, and no mail columns", () => {
    const text = sql();

    expect(text).toContain("'RFQ-S-260001'");
    expect(text).toContain("('satrio@halcominovasi.co.id', 'S')");
    expect(text).toContain("rfq_stage_steps");
    expect(text).toContain("'SOA'::\"PicTeam\"");
    expect(text).toContain("raised_by_pic_id");
    expect(text).not.toMatch(/email_link|email_message_id|email_conversation_id|responded_at|https:\/\/example\.test/);
  });
});
