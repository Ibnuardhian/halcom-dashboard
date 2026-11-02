import { redirect } from "next/navigation";

/** Email and SLA are two pages; the old address leads to the first. */
export default function SettingsPage() {
  redirect("/admin/settings/email");
}
