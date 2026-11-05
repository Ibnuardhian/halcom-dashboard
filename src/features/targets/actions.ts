"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { MONTHS, MONTH_NAMES } from "@/domain/targets/quarters";
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
  const months = Object.fromEntries(MONTHS.map((m) => [m, { grossProfit: text(formData, `grossProfit-${m}`) }]));
  const result = await saveSalesTargets(getDb(), { id: user.id, role: user.role }, { year: text(formData, "year"), months });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/dashboard/sales");
  return { ok: true, message: result.changed.length === 0 ? "Tidak ada perubahan." : `Saved targets for ${result.changed.map((m) => MONTH_NAMES[m - 1]).join(", ")}.` };
}
