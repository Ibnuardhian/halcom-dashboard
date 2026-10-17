import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME } from "@/config/app";
import { homePathFor } from "@/domain/access/dashboards";
import { LoginForm } from "@/features/auth/login-form";
import { getCurrentUser } from "@/server/auth/current-user";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>{APP_NAME}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
      {/* Signed-in users skip the form. This reads the session, so it streams in behind Suspense. */}
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
    </main>
  );
}

async function RedirectIfSignedIn() {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.role));
  return null;
}
