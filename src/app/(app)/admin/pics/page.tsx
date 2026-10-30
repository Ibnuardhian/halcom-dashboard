import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PIC_TEAM_LABELS, PIC_TEAMS } from "@/domain/pics/teams";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { AddPicForm, PicRow } from "@/features/pics/pic-forms";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listPics } from "@/server/pics/service";

export default function PicsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Pics />
    </Suspense>
  );
}

async function Pics() {
  const viewer = await requirePermission("pics.manage");
  const pics = await listPics(getDb(), viewer);

  return (
    <>
      <DashboardHeader
        title="PICs"
        summary="Tujuan tiket SOA dan Purchasing. PIC bukan akun login; setiap tim memakai satu akun bersama."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        {PIC_TEAMS.map((team) => {
          const own = pics.filter((pic) => pic.team === team);
          return (
            <Card key={team}>
              <CardHeader>
                <CardTitle className="text-base">
                  <h2>{PIC_TEAM_LABELS[team]} PICs</h2>
                </CardTitle>
                <CardDescription>
                  {own.filter((pic) => pic.isActive).length} aktif dari {own.length}. PIC dinonaktifkan agar request dan riwayat penugasannya tetap memuat namanya.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <AddPicForm team={team} />
                {own.length === 0 ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    None yet.
                  </p>
                ) : (
                  <ul aria-label={`${PIC_TEAM_LABELS[team]} PIC list`} className="divide-y">
                    {own.map((pic) => (
                      <PicRow key={pic.id} id={pic.id} name={pic.name} isActive={pic.isActive} openRequests={pic.openRequests} totalRequests={pic.totalRequests} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
