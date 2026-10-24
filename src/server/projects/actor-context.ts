import type { Prisma } from "@/generated/prisma/client";

/**
 * Names the person for the rest of this transaction (a transaction-local setting, gone at commit). The database trigger that writes a project's
 * stage history reads it, so a stage change is recorded with who made it. Without it the history row has no person; it is still written.
 */
export async function setActor(tx: Prisma.TransactionClient, actorId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.actor_id', ${actorId}, true)`;
}
