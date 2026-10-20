import { describe, expect, it } from "vitest";
import { parseRfqTickets, planRfqImport, splitPics, ticketKey, type TicketRow } from "@/server/import/rfq-tickets";
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

    expect(row).toMatchObject({ ticketId: null, entryDate: "2026-10-12", responseDate: "2026-10-13", senderEmail: "satrio.akbar@example.test", customer: "Apotek Alpro", statusLabel: "Done", pics: ["Gita", "Soraya"], note: null, emailLink: null });
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

describe("planning the import", () => {
  const plan = (lines: string[], context = {}) => {
    const result = planRfqImport(rows(...lines), context);
    expect(result.problems).toEqual([]);
    return result.plan!;
  };

  it("gives each sender one letter and numbers their tickets from 1 in date order", () => {
    const p = plan([
      ",2026-10-08,2026-10-08,gusti.nirmala@example.test,C2,P2,Done,Soraya,,,m2",
      ",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1",
      ",2026-10-07,2026-10-07,satrio.akbar@example.test,C3,P3,Done,Gita,,,m3",
    ]);

    expect(p.tickets.map((t) => [t.code, t.requesterEmail])).toEqual([
      ["RFQ-S-260001", "satrio@example.invalid"],
      ["RFQ-S-260002", "satrio@example.invalid"],
      ["RFQ-G-260001", "gusti@example.invalid"],
    ]);
    expect(Object.fromEntries(p.prefixes.map((x) => [x.email, x.prefix]))).toEqual({ "satrio@example.invalid": "S", "gusti@example.invalid": "G" });
  });

  it("keeps the ticket ids the sheet already has, decides the sender's letter from them, and numbers on from them", () => {
    const p = plan([
      ",2026-10-15,2026-10-15,ibnu.ardhiansyah@example.test,C1,P1,Done,Gita,,,m1",
      "RFQ-A-260002,2026-10-20,,adityo.prabowo@example.test,C2,P2,Baru,,,,m2",
      "RFQ-A-260003,2026-10-20,,adityo.prabowo@example.test,C3,P3,Baru,,,,m3",
    ]);

    expect(p.tickets.map((t) => t.code).sort()).toEqual(["RFQ-A-260002", "RFQ-A-260003", "RFQ-I-260001"]);
    expect(p.counters.find((c) => c.scope === "RFQ-A-26")?.last).toBe(3);
  });

  it("gives a second person with the same letter their first two letters, and continues after what exists", () => {
    const p = plan(
      [",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1", ",2026-10-06,2026-10-07,gusti.nirmala@example.test,C2,P2,Done,Gita,,,m2"],
      { existingPrefixes: new Map([["dzaki@example.invalid", "G"]]), existingCounters: new Map([["RFQ-S-26", 4]]) },
    );

    expect(p.tickets.map((t) => t.code)).toEqual(["RFQ-S-260005", "RFQ-GU-260001"]);
  });

  it("maps the sheet's statuses, with the response and outcome times and the note as the reason", () => {
    const p = plan([
      ",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1",
      ",2026-10-06,,satrio.akbar@example.test,C2,P2,Failed,Soraya,No quote in time,,m2",
      ",2026-10-06,2026-10-08,satrio.akbar@example.test,C3,P3,On Going,Gita,Waiting for photo,,m3",
      ",2026-10-06,,satrio.akbar@example.test,C4,P4,Baru,,,,m4",
    ]);
    const by = Object.fromEntries(p.tickets.map((t) => [t.title, t]));

    expect(by["P1"]).toMatchObject({ status: "COMPLETED", respondedAt: new Date("2026-10-07T08:00:00Z"), completedAt: new Date("2026-10-07T08:00:00Z") });
    expect(by["P2"]).toMatchObject({ status: "CANCELLED", respondedAt: null, completedAt: null, note: "No quote in time" });
    expect(by["P2"]?.outcomeAt).toEqual(new Date("2026-10-06T10:00:00Z"));
    expect(by["P3"]).toMatchObject({ status: "IN_PROGRESS", completedAt: null, note: "Waiting for photo" });
    expect(by["P4"]).toMatchObject({ status: "SUBMITTED", outcomeAt: null, picName: null });
    // The ticket came in at 09:00 Jakarta time.
    expect(by["P1"]?.createdAt).toEqual(new Date("2026-10-06T02:00:00Z"));
  });

  it("makes one project per customer and project, owned as D-031 says: Gusti's go to Satrio, an SOA or admin sender has no Sales PIC", () => {
    const p = plan([
      ",2026-10-06,2026-10-07,gusti.nirmala@example.test,C1,P1,Done,Gita,,,m1",
      ",2026-10-07,2026-10-07,adityo.prabowo@example.test,C2,P2,Done,Gita,,,m2",
      ",2026-10-08,2026-10-08,satrio.akbar@example.test,C1,P1,Done,Gita,,,m3",
    ]);

    expect(p.projects).toHaveLength(2);
    expect(p.projects.find((x) => x.name === "P1")).toMatchObject({ ownerEmail: "satrio@example.invalid", externalSourceName: null });
    expect(p.projects.find((x) => x.name === "P2")).toMatchObject({ ownerEmail: null, externalSourceName: "Adityo Prabowo" });
    expect(p.tickets.filter((t) => t.projectKey === p.projects.find((x) => x.name === "P1")!.key)).toHaveLength(2);
  });

  it("assigns the first PIC when two are named and keeps the whole text", () => {
    const p = plan([",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita & Soraya,,,m1"]);

    expect(p.tickets[0]).toMatchObject({ picName: "Gita", picNames: ["Gita", "Soraya"] });
    expect(p.tickets[0]?.description).toContain("PIC in the tracker: Gita & Soraya.");
    expect(p.pics.map((x) => x.name)).toEqual(["Gita", "Soraya"]);
  });

  it("stops on a sender nobody mapped, and on the same ticket twice", () => {
    expect(planRfqImport(rows(",2026-10-06,,stranger@example.test,C1,P1,Done,Gita,,,m1")).problems[0]).toMatch(/not mapped to an account/);
    const twice = planRfqImport(rows(",2026-10-06,,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1", ",2026-10-07,,satrio.akbar@example.test,C2,P2,Done,Gita,,,m1"));
    expect(twice.problems[0]).toMatch(/same ticket twice/);
  });

  it("refuses a sheet code whose letter belongs to somebody else", () => {
    const result = planRfqImport(rows("RFQ-A-260002,2026-10-20,,adityo.prabowo@example.test,C,P,Baru,,,,m1"), { existingPrefixes: new Map([["dzaki@example.invalid", "A"]]) });

    expect(result.problems[0]).toMatch(/belongs to someone else/);
  });

  it("gives a ticket the same key every time", () => {
    const [a] = rows(",2026-10-06,2026-10-07,satrio.akbar@example.test,C1,P1,Done,Gita,,,m1");
    expect(ticketKey(a!)).toBe(ticketKey({ ...a!, line: 99 }));
    expect(ticketKey(a!)).not.toBe(ticketKey({ ...a!, messageId: "m2" }));
  });
});

describe("the SQL file", () => {
  const plan = planRfqImport(
    rows(",2026-10-06,2026-10-07,gusti.nirmala@example.test,O'Neil Co,\"Kabel; DROP TABLE users; --\",Done,Gita,It's done,https://example.test/a?b=1,<m@x>,c1"),
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
    expect(text).toContain("ON CONFLICT (email) DO NOTHING");
    expect(text).toContain("WHERE NOT EXISTS (SELECT 1 FROM requests r WHERE r.submission_key = s.ticket_key)");
  });

  it("carries the planned code, the prefix and the locked hash of the history-only account", () => {
    const text = sql();

    expect(text).toContain("'RFQ-G-260001'");
    expect(text).toContain("('gusti@example.invalid', 'G')");
    expect(text).toContain("'scrypt$locked'");
  });
});
