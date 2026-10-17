"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { QUARTERS } from "@/domain/targets/quarters";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { saveSalesTargets } from "@/server/targets/service";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Saves the signed-in salesperson's targets for one year. */
export async function saveTargetsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const quarters = Object.fromEntries(QUARTERS.map((q) => [q, { revenue: text(formData, `revenue-${q}`), grossProfit: text(formData, `grossProfit-${q}`) }]));
  const result = await saveSalesTargets(getDb(), { id: user.id, role: user.role }, { year: text(formData, "year"), quarters });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/dashboard/sales");
  return { ok: true, message: result.changed.length === 0 ? "Nothing changed." : `Saved targets for ${result.changed.map((q) => `Q${q}`).join(", ")}.` };
}
