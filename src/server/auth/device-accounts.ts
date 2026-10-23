import { connection } from "next/server";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { readDeviceEntries } from "./device-cookie";
import { verifyDeviceCredential } from "./device-credentials";

export type RememberedAccount = { credentialId: string; name: string; email: string; role: Role };

/**
 * The accounts this browser remembered that can still be switched to without a password. Name, email and role come from the stored
 * records, not from the cookie, and an entry that no longer verifies (deactivated, role changed to one that is not remembered, expired,
 * revoked) is simply left out.
 */
export async function readRememberedAccounts(): Promise<RememberedAccount[]> {
  const db = getDb();
  const accounts: RememberedAccount[] = [];
  const entries = await readDeviceEntries();
  await connection(); // the clock below is request-time data, never prerendered
  const now = new Date();
  for (const entry of entries) {
    const user = await verifyDeviceCredential(db, entry, now);
    if (user) accounts.push({ credentialId: entry.id, name: user.name, email: user.email, role: user.role });
  }
  return accounts;
}
