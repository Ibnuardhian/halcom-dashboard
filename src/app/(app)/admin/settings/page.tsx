import { redirect } from "next/navigation";

/** The two teams have a module each; the old address leads to the first. */
export default function SettingsPage() {
  redirect("/admin/settings/soa");
}
