import { Suspense } from "react";
import Link from "next/link";
import { NavLink } from "@/components/app-shell/nav-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/config/app";
import { ROLE_LABELS } from "@/domain/access/roles";
import { logoutAction } from "@/features/auth/actions";
import { navLinksFor } from "@/features/navigation/links";
import { requireUser } from "@/server/auth/current-user";

// Every page under (app) is per-user and needs a live session check (a deactivated
// user must lose access immediately, so the session cannot be cached ahead of time).
// Navigations into this segment therefore block on the server, and instant-navigation
// validation, which renders without a session, cannot succeed here.
export const instant = false;

// Everything under (app) needs a signed-in user. The session is read at request
// time, so the authenticated shell streams in behind this Suspense boundary.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading…</p>}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const links = navLinksFor(user.role);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-heading text-base font-semibold">
            {APP_NAME}
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
            {links.map((link) => (
              <NavLink key={link.href} href={link.href}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm">{user.name}</span>
            <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
