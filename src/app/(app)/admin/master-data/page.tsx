import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { can } from "@/domain/access/permissions";
import { MASTER_KINDS, MASTER_KIND_LABELS } from "@/domain/projects/master-data";
import { IndustryNote, NewIndustryForm } from "@/features/customers/industry-admin";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { MasterList } from "@/features/masterdata/master-list";
import { ProjectTabs } from "@/features/projects/project-tabs";
import { NewPhaseForm, NewSectionForm, PhaseRow, SectionRow } from "@/features/sections/section-forms";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listIndustries } from "@/server/customers/industries";
import { listMasterRecords } from "@/server/masterdata/service";
import { listSoaPhases } from "@/server/requests/queries";
import { listSections } from "@/server/sections/service";

export default function MasterDataPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <MasterData />
    </Suspense>
  );
}

/** A tab's heading and the line that says what the list is for. */
function Intro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

async function MasterData() {
  const viewer = await requirePermission("masterdata.manage");
  const manageSections = can(viewer.role, "sections.manage");
  const [sections, phases] = manageSections ? await Promise.all([listSections(getDb(), viewer, { includeInactive: true }), listSoaPhases(getDb(), viewer)]) : [[], []];
  const manageIndustries = can(viewer.role, "industries.manage");
  const industries = manageIndustries ? await listIndustries(getDb(), viewer) : [];
  const lists = await Promise.all(MASTER_KINDS.map(async (kind) => ({ kind, records: await listMasterRecords(getDb(), viewer, kind) })));

  const tabs = [
    ...lists.map(({ kind, records }) => ({
      id: kind,
      label: `${MASTER_KIND_LABELS[kind]} (${records.length})`,
      content: (
        <>
          <Intro title={`${MASTER_KIND_LABELS[kind]}s`}>Dibuat dari bagian Technical project. Nama bersifat unik tanpa membedakan huruf besar kecil dan spasi; mengubah nama tidak memutus project yang memakainya.</Intro>
          <MasterList kind={kind} label={MASTER_KIND_LABELS[kind]} items={records.map((record) => ({ id: record.id, name: record.name, count: record.projectCount }))} />
        </>
      ),
    })),
    ...(manageIndustries
      ? [
          {
            id: "industry",
            label: `Industri (${industries.length})`,
            content: (
              <>
                <Intro title="Industri customer">
                  <IndustryNote />
                </Intro>
                <div className="mb-4">
                  <NewIndustryForm />
                </div>
                <MasterList kind="industry" label="Industri" items={industries.map((industry) => ({ id: industry.id, name: industry.name, count: industry.customers }))} />
              </>
            ),
          },
        ]
      : []),
    ...(manageSections
      ? [
          {
            id: "sections",
            label: `Technical sections (${sections.length})`,
            content: (
              <>
                <Intro title="Technical sections">
                  Bagian tambahan di tab Technical setiap proyek, selain yang bawaan (Assessment, Sizing, BOQ, dan seterusnya). Isi proyek yang sudah ada tidak berubah. Bagian yang tidak dipakai lagi disembunyikan, tetapi isinya tetap tersimpan.
                </Intro>
                <div className="flex flex-col gap-4">
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
                </div>
              </>
            ),
          },
          {
            id: "phases",
            label: `SOA phases (${phases.length})`,
            content: (
              <>
                <Intro title="SOA phases">
                  Pilihan SOA phase pada project. Assessment, Sizing, dan POC sudah ada; phase baru (misalnya Pre Assessment) muncul sebagai pilihan bagi SOA. Project yang sudah memakai phase tetap menyimpannya.
                </Intro>
                <div className="flex flex-col gap-4">
                  <NewPhaseForm />
                  <ul aria-label="SOA phases list" className="divide-y">
                    {phases.map((phase) => (
                      <PhaseRow key={phase.key} phase={phase} />
                    ))}
                  </ul>
                </div>
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <DashboardHeader title="Master data" summary="Daftar klasifikasi project dan customer. Pilih tab, cari nama, lalu klik Edit." />
      <ProjectTabs tabs={tabs} defaultTab="principal" label="Master data" />
    </>
  );
}
