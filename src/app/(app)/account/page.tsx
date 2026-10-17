import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/domain/access/roles";
import { ChangePasswordForm } from "@/features/account/change-password-form";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { Fact } from "@/features/requests/fact";
import { requireUser } from "@/server/auth/current-user";

export default function AccountPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Account />
    </Suspense>
  );
}

async function Account() {
  const user = await requireUser();
  return (
    <>
      <DashboardHeader title="Account" summary="Your sign-in details and password." />
      <Card className="mb-6">
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Fact label="Name">{user.name}</Fact>
            <Fact label="Email">{user.email}</Fact>
            <Fact label="Role">{ROLE_LABELS[user.role]}</Fact>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Change password</h2>
          </CardTitle>
          <CardDescription>Changing it signs you out of every other browser and device.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </>
  );
}
