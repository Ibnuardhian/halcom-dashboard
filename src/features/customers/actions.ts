"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { setCustomerIndustry } from "@/server/customers/service";

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

/** Saves the industry of a customer. The service checks the permission, the value and that the customer exists. */
export async function saveCustomerIndustryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await setCustomerIndustry(getDb(), { id: user.id, role: user.role }, { customerId: text(formData, "customerId"), industry: text(formData, "industry") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/customers");
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/sales");
  return { ok: true, message: result.changed ? (result.industry ? `Industry saved: ${result.industry}.` : "Industry cleared.") : "Nothing changed." };
}
