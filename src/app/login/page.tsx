import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/app-shell/brand-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME, APP_TAGLINE } from "@/config/app";
import { homePathFor } from "@/domain/access/dashboards";
import { LoginForm } from "@/features/auth/login-form";
import { getCurrentUser } from "@/server/auth/current-user";

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-gradient-to-b from-accent/60 to-background px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandLogo className="h-12" priority />
          <h1 className="sr-only">{APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Use your {APP_NAME} account.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
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
