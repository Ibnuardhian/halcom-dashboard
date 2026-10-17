"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, UserRound, X } from "lucide-react";
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
  /** Optional navbar controls rendered by the server (for example the superadmin theme switcher). */
  controls?: React.ReactNode;
  /** Unread notifications of the signed-in user, and where the list lives. */
  notifications: { href: string; unread: number };
  /** The sign-out form, a server action passed in by the layout. */
  signOut: React.ReactNode;
  children: React.ReactNode;
};

const SIDEBAR_ID = "app-sidebar";
const PROFILE_MENU_ID = "profile-menu";

/**
 * A navbar across the top at every width (sidebar button, notifications, profile) and a sidebar of modules beside the
 * page. The sidebar button hides and shows the sidebar on a desktop; below `md` the sidebar is a drawer that closes on
 * navigation, on Escape and on a click outside.
 */
export function AppShell({ sections, user, accountHref, controls, notifications, signOut, children }: Props) {
  const pathname = usePathname();
  // The drawer is open only for the page it was opened on, so navigating closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  // On a desktop the sidebar can be hidden to give the page the whole width.
  const [desktopHidden, setDesktopHidden] = useState(false);

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
          "w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-svh md:w-64",
          open ? "fixed inset-y-0 left-0 z-40 flex shadow-xl" : "hidden",
          desktopHidden ? "md:hidden" : "md:flex",
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
      </aside>

      {open ? <div aria-hidden className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpenedOn(null)} /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-6">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls={SIDEBAR_ID}
            onClick={() => setOpenedOn(open ? null : pathname)}
          >
            <Menu aria-hidden />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="hidden md:inline-flex"
            aria-label={desktopHidden ? "Show sidebar" : "Hide sidebar"}
            aria-expanded={!desktopHidden}
            aria-controls={SIDEBAR_ID}
            onClick={() => setDesktopHidden((hidden) => !hidden)}
          >
            {desktopHidden ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          </Button>
          <Link href="/" aria-label={`${APP_NAME} home`} className={cn("rounded-md outline-offset-4 md:hidden", desktopHidden && "md:block")}>
            <BrandLogo className="h-7" />
          </Link>

          <div className="ml-auto flex items-center gap-2">
            {controls ? <div className="w-28 sm:w-32">{controls}</div> : null}
            <NotificationBell href={notifications.href} unread={notifications.unread} active={isActivePath(pathname, notifications.href)} />
            <ProfileMenu user={user} accountHref={accountHref} signOut={signOut} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** A link to the notification list with the unread count; the count is also in the accessible name. */
function NotificationBell({ href, unread, active }: { href: string; unread: number; active: boolean }) {
  const label = unread === 0 ? "Notifications" : `Notifications, ${unread} unread`;
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className="relative flex size-9 items-center justify-center rounded-lg border hover:bg-muted aria-[current=page]:bg-muted"
    >
      <Bell aria-hidden className="size-4" />
      {unread > 0 ? (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tabular-nums"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

/** The signed-in person: name and role, a link to the account page and sign out. Closes on Escape, outside click and navigation. */
function ProfileMenu({ user, accountHref, signOut }: { user: ShellUser; accountHref: string; signOut: React.ReactNode }) {
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedOn(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpenedOn(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Profile menu"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={PROFILE_MENU_ID}
        onClick={() => setOpenedOn(open ? null : pathname)}
        className="flex h-9 items-center gap-2 rounded-lg border pr-2 pl-1 hover:bg-muted"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <UserRound aria-hidden className="size-4" />
        </span>
        <span className="hidden max-w-32 truncate text-sm font-medium sm:block">{user.name}</span>
        <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
      </button>
      {open ? (
        <div id={PROFILE_MENU_ID} className="absolute right-0 z-30 mt-2 flex w-64 flex-col gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="min-w-0 px-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.roleLabel}</p>
          </div>
          <Link href={accountHref} className="rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
            Account
          </Link>
          {signOut}
        </div>
      ) : null}
    </div>
  );
}
