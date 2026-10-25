import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isRevisionNotification } from "@/domain/notifications/kinds";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { markAllReadAction, markReadAction } from "@/features/notifications/actions";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { listNotifications } from "@/server/notifications/service";

export default function NotificationsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Notifications />
    </Suspense>
  );
}

async function Notifications() {
  const user = await requireUser();
  const rows = await listNotifications(getDb(), user.id);
  const unread = rows.filter((row) => row.readAt === null).length;

  return (
    <>
      <DashboardHeader title="Notifications" summary="Request yang masuk ke tim Anda, dan perubahan yang dibuat divisi lain pada proyek yang Anda kerjakan." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {unread === 0 ? "You are all caught up." : `${unread} unread`}
        </p>
        {unread > 0 ? (
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline">
              Mark all as read
            </Button>
          </form>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing yet. New requests for your team and updates from other divisions will show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className={isRevisionNotification(row.kind) ? (row.readAt === null ? "border-destructive bg-destructive/10" : "border-destructive/40") : row.readAt === null ? "border-primary/50 bg-accent/40" : undefined}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {isRevisionNotification(row.kind) ? <span className="mb-1 inline-block rounded bg-destructive px-1.5 py-px text-[11px] font-semibold tracking-wide text-white uppercase">Revision</span> : null}
                    <Link href={row.href} className={isRevisionNotification(row.kind) ? "block font-medium text-destructive underline-offset-4 hover:underline" : "font-medium text-primary underline-offset-4 hover:underline"}>
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
