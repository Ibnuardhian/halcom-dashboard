import { notFound, redirect } from "next/navigation";

/** The old per-team addresses lead to their section of the Email page. */
export default async function TeamSettingsPage({ params }: PageProps<"/admin/settings/[team]">) {
  const { team } = await params;
  if (team !== "soa" && team !== "purchasing") notFound();
  redirect(`/admin/settings/email#${team}`);
}
