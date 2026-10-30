import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MASTER_KINDS, MASTER_KIND_LABELS } from "@/domain/projects/master-data";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { MasterRecordRow } from "@/features/masterdata/master-record-row";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listMasterRecords } from "@/server/masterdata/service";
import { can } from "@/domain/access/permissions";
import { NewPhaseForm, NewSectionForm, PhaseRow, SectionRow } from "@/features/sections/section-forms";
import { listSections } from "@/server/sections/service";
import { listSoaPhases } from "@/server/requests/queries";
import { IndustryRow, NewIndustryForm } from "@/features/customers/industry-admin";
import { listIndustries } from "@/server/customers/industries";

export default function MasterDataPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <MasterData />
    </Suspense>
  );
}

async function MasterData() {
  const viewer = await requirePermission("masterdata.manage");
  const manageSections = can(viewer.role, "sections.manage");
  const [sections, phases] = manageSections ? await Promise.all([listSections(getDb(), viewer, { includeInactive: true }), listSoaPhases(getDb(), viewer)]) : [[], []];
  const manageIndustries = can(viewer.role, "industries.manage");
  const industries = manageIndustries ? await listIndustries(getDb(), viewer) : [];
  const lists = await Promise.all(MASTER_KINDS.map(async (kind) => ({ kind, records: await listMasterRecords(getDb(), viewer, kind) })));

  return (
    <>
      <DashboardHeader
        title="Master data"
        summary="Principal dan Solution yang digunakan untuk mengklasifikasikan proyek. Data baru dibuat dari bagian Technical sebuah proyek; di sini namanya dapat diubah, atau dihapus kalau tidak ada proyek yang memakainya lagi."
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
      {manageIndustries ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Industri customer</h2>
            </CardTitle>
            <CardDescription>
              Daftar pilihan industri di halaman Customers. Mengubah nama ikut mengubah customer yang memakainya; industri hanya bisa dihapus bila tidak ada customer atau project yang memakainya.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <NewIndustryForm />
            {industries.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                Belum ada industri.
              </p>
            ) : (
              <ul aria-label="Daftar industri" className="divide-y">
                {industries.map((industry) => (
                  <IndustryRow key={industry.id} industry={industry} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
      {manageSections ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <h2>Technical sections</h2>
              </CardTitle>
              <CardDescription>
                Bagian tambahan di tab Technical setiap proyek, selain yang bawaan (Assessment, Sizing, BOQ, dan seterusnya). Isi proyek yang sudah ada tidak berubah. Bagian yang tidak dipakai lagi disembunyikan, tetapi isinya tetap tersimpan.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <NewSectionForm />
              {sections.length === 0 ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Belum ada bagian tambahan.
                </p>
              ) : (
                <ul aria-label="Technical sections list" className="divide-y">
                  {sections.map((section) => (
                    <SectionRow key={section.id} section={{ id: section.id, label: section.label, kind: section.kind as "TEXT" | "CHOICE", options: section.options, isActive: section.isActive }} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <h2>SOA phases</h2>
              </CardTitle>
              <CardDescription>
                Pilihan SOA phase pada project. Assessment, Sizing, dan POC sudah ada; phase baru (misalnya Pre Assessment) muncul sebagai pilihan bagi SOA. Project yang sudah memakai sebuah phase tetap menyimpannya.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <NewPhaseForm />
              <ul aria-label="SOA phases list" className="divide-y">
                {phases.map((phase) => (
                  <PhaseRow key={phase.key} phase={phase} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
