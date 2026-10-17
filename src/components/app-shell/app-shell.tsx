"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME, APP_TAGLINE } from "@/config/app";
import type { NavSection } from "@/features/navigation/links";
import { cn } from "@/lib/utils";
import { BrandLogo } from "./brand-logo";
import { isActivePath, NavLink } from "./nav-link";

type ShellUser = { name: string; roleLabel: string };

type Props = {
  sections: NavSection[];
  user: ShellUser;
  accountHref: string;
  /** Optional header controls rendered by the server (for example the superadmin theme switcher). */
  controls?: React.ReactNode;
  /** Unread notifications of the signed-in user, and where the list lives. */
  notifications: { href: string; unread: number };
  /** The sign-out form, a server action passed in by the layout. */
  signOut: React.ReactNode;
  children: React.ReactNode;
};

const SIDEBAR_ID = "app-sidebar";

/**
 * Sidebar layout. At `md` and wider the sidebar is a fixed column; below that it is hidden and a
 * top bar opens it as a drawer. The drawer closes on navigation, on Escape and on a click outside.
 */
export function AppShell({ sections, user, accountHref, controls, notifications, signOut, children }: Props) {
  const pathname = usePathname();
  // The drawer is open only for the page it was opened on, so navigating closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedOn(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="flex min-h-svh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside
        id={SIDEBAR_ID}
        aria-label={`${APP_NAME} sidebar`}
        className={cn(
          "w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-svh md:w-64",
          open ? "fixed inset-y-0 left-0 z-40 flex shadow-xl" : "hidden",
        )}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <Link href="/" aria-label={`${APP_NAME} home`} className="rounded-md outline-offset-4">
            <BrandLogo priority />
          </Link>
          <Button type="button" variant="ghost" size="icon" className="md:hidden" aria-label="Close menu" onClick={() => setOpenedOn(null)}>
            <X aria-hidden />
          </Button>
        </div>
        <p className="px-5 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{APP_TAGLINE}</p>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
          {sections.map((section) => (
            <div key={section.group} className="mt-4 first:mt-0">
              <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.label}</h2>
              <ul className="flex flex-col gap-0.5">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <NavLink href={link.href} icon={link.icon}>
                      {link.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-3 border-t p-4">
          {controls}
          <NotificationBell href={notifications.href} unread={notifications.unread} active={isActivePath(pathname, notifications.href)} />
          <Link
            href={accountHref}
            aria-current={isActivePath(pathname, accountHref) ? "page" : undefined}
            className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <UserRound aria-hidden className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.roleLabel} · Account</span>
            </span>
          </Link>
          {signOut}
        </div>
      </aside>

      {open ? (
        <div aria-hidden className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpenedOn(null)} />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur md:hidden">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls={SIDEBAR_ID}
            onClick={() => setOpenedOn(pathname)}
          >
            <Menu aria-hidden />
          </Button>
          <BrandLogo className="h-7" />
          <span className="ml-auto">
            <NotificationBell href={notifications.href} unread={notifications.unread} active={isActivePath(pathname, notifications.href)} compact />
          </span>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** A link to the notification list with the unread count; the count is also in the accessible name. */
function NotificationBell({ href, unread, active, compact = false }: { href: string; unread: number; active: boolean; compact?: boolean }) {
  const label = unread === 0 ? "Notifications" : `Notifications, ${unread} unread`;
  return (
    <Link
      href={href}
      aria-label={compact ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg text-sm hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent",
        compact ? "size-9 justify-center border" : "px-1 py-1",
      )}
    >
      <span className={cn("flex items-center justify-center", compact ? "" : "size-8 shrink-0 rounded-full bg-muted")}>
        <Bell aria-hidden className="size-4" />
      </span>
      {compact ? null : <span className="font-medium">{label}</span>}
      {unread > 0 ? (
        <span
          aria-hidden
          className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tabular-nums",
            compact ? "absolute -top-1.5 -right-1.5" : "ml-auto",
          )}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
