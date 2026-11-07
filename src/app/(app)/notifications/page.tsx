import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isRevisionNotification } from "@/domain/notifications/kinds";
import { isNotificationSeverity, NOTIFICATION_SEVERITIES, SEVERITY_DESCRIPTIONS, SEVERITY_LABELS, type NotificationSeverity } from "@/domain/notifications/severity";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { markAllReadAction, markReadAction } from "@/features/notifications/actions";
import { SEVERITY_CARD_CLASS, SEVERITY_LABEL_CLASS, SEVERITY_LINK_CLASS } from "@/features/notifications/severity-style";
import { NOTIFICATIONS_PATH } from "@/features/navigation/links";
import { cn } from "@/lib/utils";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { countUnreadBySeverity, listNotifications } from "@/server/notifications/service";

export default function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Notifications searchParams={searchParams} />
    </Suspense>
  );
}

const tabHref = (severity: NotificationSeverity | null): string => (severity ? `${NOTIFICATIONS_PATH}?level=${severity.toLowerCase()}` : NOTIFICATIONS_PATH);

async function Notifications({ searchParams }: Pick<PageProps<"/notifications">, "searchParams">) {
  const user = await requireUser();
  const query = await searchParams;
  const level = typeof query.level === "string" ? query.level.toUpperCase() : null;
  const active = isNotificationSeverity(level) ? level : null;

  const [rows, counts] = await Promise.all([listNotifications(getDb(), user.id, active ?? undefined), countUnreadBySeverity(getDb(), user.id)]);
  const unread = rows.filter((row) => row.readAt === null).length;
  const unreadAll = counts.INFO + counts.WARNING + counts.DANGER;

  return (
    <>
      <DashboardHeader title="Notifications" summary="Info untuk request baru dan perubahan divisi lain, Warning untuk SLA yang mendekati batas, Danger untuk SLA yang terlewat." />
      <nav aria-label="Tingkat notifikasi" className="mb-4 flex flex-wrap gap-2">
        {[null, ...NOTIFICATION_SEVERITIES].map((severity) => {
          const count = severity ? counts[severity] : unreadAll;
          const selected = severity === active;
          return (
            <Link
              key={severity ?? "all"}
              href={tabHref(severity)}
              aria-current={selected ? "page" : undefined}
              className={cn("flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted", selected && "border-primary bg-muted")}
            >
              {severity ? SEVERITY_LABELS[severity] : "Semua"}
              <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums", count > 0 ? (severity ? SEVERITY_LABEL_CLASS[severity] : "bg-primary text-primary-foreground") : "bg-muted text-muted-foreground")}>
                <span className="sr-only">{count} belum dibaca</span>
                <span aria-hidden>{count > 99 ? "99+" : count}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      {active ? <p className="mb-3 text-sm text-muted-foreground">{SEVERITY_DESCRIPTIONS[active]}</p> : null}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {unread === 0 ? "You are all caught up." : `${unread} unread`}
        </p>
        {unread > 0 ? (
          <form action={markAllReadAction}>
            {active ? <input type="hidden" name="severity" value={active} /> : null}
            <Button type="submit" variant="outline">
              {active ? `Mark all ${SEVERITY_LABELS[active]} as read` : "Mark all as read"}
            </Button>
          </form>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {active ? `Tidak ada notifikasi ${SEVERITY_LABELS[active]}.` : "Nothing yet. New requests for your team and updates from other divisions will show up here."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className={row.readAt === null ? SEVERITY_CARD_CLASS[row.severity].unread : SEVERITY_CARD_CLASS[row.severity].read || undefined}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {row.severity === "INFO" ? null : <span className={cn("mb-1 inline-block rounded px-1.5 py-0.5 text-xs font-semibold", SEVERITY_LABEL_CLASS[row.severity])}>{isRevisionNotification(row.kind) ? `${SEVERITY_LABELS[row.severity]} · Revision` : SEVERITY_LABELS[row.severity]}</span>}
                    <Link href={row.href} className={cn("block font-medium underline-offset-4 hover:underline", SEVERITY_LINK_CLASS[row.severity])}>
                      {row.title}
                    </Link>
                    {row.body ? <p className="mt-0.5 text-sm break-words text-muted-foreground">{row.body}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDay(row.createdAt)}
                      {row.readAt === null ? " · unread" : ""}
                    </p>
                  </div>
                  {row.readAt === null ? (
                    <form action={markReadAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Mark as read
                      </Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
