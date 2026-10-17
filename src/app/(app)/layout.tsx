import { Suspense } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { can } from "@/domain/access/permissions";
import { ROLE_LABELS } from "@/domain/access/roles";
import { logoutAction } from "@/features/auth/actions";
import { ACCOUNT_PATH, NOTIFICATIONS_PATH, navSectionsFor } from "@/features/navigation/links";
import { ThemeSwitcher } from "@/features/theme/theme-switcher";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { countUnread } from "@/server/notifications/service";

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
  const unread = await countUnread(getDb(), user.id);

  return (
    <AppShell
      sections={navSectionsFor(user.role)}
      user={{ name: user.name, roleLabel: ROLE_LABELS[user.role] }}
      accountHref={ACCOUNT_PATH}
      notifications={{ href: NOTIFICATIONS_PATH, unread }}
      controls={can(user.role, "theme.switch") ? <ThemeSwitcher /> : null}
      signOut={
        <form action={logoutAction}>
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      }
    >
      {children}
    </AppShell>
  );
}
