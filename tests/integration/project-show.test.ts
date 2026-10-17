import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createProject } from "@/server/requests/service";
import { listProjects } from "@/server/requests/queries";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("listProjects behind the pipeline tiles", () => {
  it("narrows to open, open pipeline, estimated gross profit and won, for one salesperson", async () => {
    const user = await makeUser("SALES");
    const sales = { id: user.id, role: user.role };
    const tag = randomBytes(3).toString("hex");
    const make = async (name: string, data: Record<string, unknown>) => {
      const created = await createProject(db, sales, { endUserCompany: `PT ${tag}`, name });
      if (!created.ok) throw new Error(created.message);
      await db.project.update({ where: { id: created.value.id }, data });
      return created.value.code;
    };
    const bare = await make("bare", {});
    const valued = await make("valued", { estimatedValue: 100 });
    const margined = await make("margined", { estimatedValue: 100, targetMargin: 10 });
    const done = await make("done", { estimatedValue: 100, targetMargin: 10, trackStatus: "DONE" });
    const won = await make("won", { progress: "CLOSED_WON", estimatedValue: 100 });
    const lost = await make("lost", { progress: "CLOSED_LOST", estimatedValue: 100 });

    const codes = async (show: "open" | "pipeline" | "margin" | "won") =>
      (await listProjects(db, sales, { show, salesOwnerId: sales.id })).map((p) => p.code).sort();

    expect(await codes("open")).toEqual([bare, valued, margined].sort());
    expect(await codes("pipeline")).toEqual([valued, margined].sort());
    expect(await codes("margin")).toEqual([margined]);
    expect(await codes("won")).toEqual([won]);
    expect(await codes("open")).not.toContain(done);
    expect(await codes("open")).not.toContain(lost);
  });
});
