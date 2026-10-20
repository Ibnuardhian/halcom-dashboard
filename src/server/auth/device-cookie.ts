import { cookies } from "next/headers";
import { DEVICE_CREDENTIAL_TTL_MS } from "@/domain/access/device";
import { parseDeviceEntries, withDeviceEntry, withoutDeviceEntry, type DeviceEntry } from "./device-policy";

const COOKIE_NAME = "device_accounts";

export async function readDeviceEntries(): Promise<DeviceEntry[]> {
  return parseDeviceEntries((await cookies()).get(COOKIE_NAME)?.value);
}

async function write(list: readonly DeviceEntry[]): Promise<void> {
  const jar = await cookies();
  if (list.length === 0) {
    jar.delete(COOKIE_NAME);
    return;
  }
  jar.set(COOKIE_NAME, JSON.stringify(list), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_CREDENTIAL_TTL_MS / 1000,
  });
}

export async function storeDeviceEntry(entry: DeviceEntry): Promise<void> {
  await write(withDeviceEntry(await readDeviceEntries(), entry));
}

export async function dropDeviceEntry(id: string): Promise<void> {
  await write(withoutDeviceEntry(await readDeviceEntries(), id));
}

export async function dropAllDeviceEntries(): Promise<void> {
  await write([]);
}
