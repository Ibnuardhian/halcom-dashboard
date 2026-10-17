import type { Prisma } from "@/generated/prisma/client";
import { codeScope, formatCode, initialsFromEmail, PROJECT_CODE_WIDTH, twoDigitYear } from "@/domain/requests/codes";
import type { RequestType } from "@/domain/requests/types";

type Tx = Prisma.TransactionClient;

/**
 * Atomically takes the next number of a scope. The single upsert locks the counter row until the
 * surrounding transaction ends, so two concurrent requests can never receive the same code, and a
 * rolled-back transaction gives its number back.
 */
async function nextSequence(tx: Tx, scope: string): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO code_counters (scope, last_value) VALUES (${scope}, 1)
    ON CONFLICT (scope) DO UPDATE SET last_value = code_counters.last_value + 1
    RETURNING last_value`;
  const value = rows[0]?.last_value;
  if (value === undefined) throw new Error("Code counter returned no value.");
  return value;
}

export async function nextRequestCode(tx: Tx, type: RequestType, requesterEmail: string, now: Date): Promise<string> {
  const scope = codeScope(type, initialsFromEmail(requesterEmail), twoDigitYear(now));
  return formatCode(scope, await nextSequence(tx, scope));
}

/** Project codes are PRJ-001, PRJ-002...: one sequence, continuing after the highest imported code. */
export async function nextProjectCode(tx: Tx): Promise<string> {
  const scope = codeScope("PRJ", "", "");
  return formatCode(scope, await nextSequence(tx, scope), PROJECT_CODE_WIDTH);
}
