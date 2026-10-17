import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MASTER_KINDS, MASTER_KIND_LABELS } from "@/domain/projects/master-data";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { MasterRecordRow } from "@/features/masterdata/master-record-row";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listMasterRecords } from "@/server/masterdata/service";

export default function MasterDataPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <MasterData />
    </Suspense>
  );
}

async function MasterData() {
  const viewer = await requirePermission("masterdata.manage");
  const lists = await Promise.all(MASTER_KINDS.map(async (kind) => ({ kind, records: await listMasterRecords(getDb(), viewer, kind) })));

  return (
    <>
      <DashboardHeader
        title="Master data"
        summary="The Principals and Solutions projects are classified with. New ones are created from a project's Technical section; here they are renamed, or deleted when no project uses them."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        {lists.map(({ kind, records }) => (
          <Card key={kind}>
            <CardHeader>
              <CardTitle className="text-base">
                <h2>{MASTER_KIND_LABELS[kind]}s</h2>
              </CardTitle>
              <CardDescription>
                {records.length} record{records.length === 1 ? "" : "s"}. A name is unique ignoring case and spacing. Renaming keeps every project that uses it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {records.length === 0 ? (
                <p role="status" className="text-sm text-muted-foreground">
                  None yet.
                </p>
              ) : (
                <ul aria-label={`${MASTER_KIND_LABELS[kind]} list`} className="divide-y">
                  {records.map((record) => (
                    <MasterRecordRow key={record.id} kind={kind} id={record.id} name={record.name} projectCount={record.projectCount} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
