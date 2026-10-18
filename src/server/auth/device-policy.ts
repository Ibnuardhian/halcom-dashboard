import { z } from "zod";
import { MAX_REMEMBERED_ACCOUNTS } from "@/domain/access/device";

/**
 * The cookie that remembers accounts on a browser holds only `{ id, token }` pairs: the id of the stored credential and the random
 * token. No name, email or role is in it (the sign-in page looks those up on the server), and the token alone is worthless without
 * the stored salted hash. Kept free of server-only imports so it can be unit-tested.
 */
export type DeviceEntry = { id: string; token: string };

const entrySchema = z.object({ id: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/) });

/** Parses the cookie value defensively: anything malformed, oversized or duplicated is dropped, never trusted. */
export function parseDeviceEntries(raw: string | undefined): DeviceEntry[] {
  if (!raw || raw.length > 4000) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const entries: DeviceEntry[] = [];
  for (const item of json) {
    const entry = entrySchema.safeParse(item);
    if (entry.success && !entries.some((other) => other.id === entry.data.id)) entries.push(entry.data);
    if (entries.length === MAX_REMEMBERED_ACCOUNTS) break;
  }
  return entries;
}

/** The list after `entry` was added or replaced: it goes first, and the oldest entries fall off at the limit. */
export function withDeviceEntry(list: readonly DeviceEntry[], entry: DeviceEntry): DeviceEntry[] {
  return [entry, ...list.filter((other) => other.id !== entry.id)].slice(0, MAX_REMEMBERED_ACCOUNTS);
}

export function withoutDeviceEntry(list: readonly DeviceEntry[], id: string): DeviceEntry[] {
  return list.filter((entry) => entry.id !== id);
}
