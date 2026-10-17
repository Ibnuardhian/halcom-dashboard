import { Suspense } from "react";
import { redirect } from "next/navigation";
import { homePathFor } from "@/domain/access/dashboards";
import { getCurrentUser } from "@/server/auth/current-user";

export default function Home() {
  return (
    <Suspense>
      <SendToStartPage />
    </Suspense>
  );
}

async function SendToStartPage(): Promise<never> {
  const user = await getCurrentUser();
  redirect(user ? homePathFor(user.role) : "/login");
}
