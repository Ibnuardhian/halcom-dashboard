import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/domain/access/permissions";
import { marginFactor, taxLabel } from "@/domain/projects/tax-basis";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { TaxBasisForm } from "@/features/settings/tax-basis-form";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getTaxBasis } from "@/server/settings/app-settings";

export default function TaxBasisPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <TaxBasis />
    </Suspense>
  );
}

async function TaxBasis() {
  const viewer = await requirePermission("settings.view");
  const mayEdit = can(viewer.role, "settings.manage");
  const basis = await getTaxBasis(getDb());
  const factor = marginFactor(basis);
  const example = 111_000_000;

  return (
    <>
      <DashboardHeader
        title="Basis PPN"
        summary={`Menentukan apakah Estimated PO value dan margin memakai PPN, supaya persentase margin dihitung dari dasar yang sama.${mayEdit ? "" : " Hanya Superadmin yang bisa mengubahnya."}`}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Pengaturan saat ini</h2>
          </CardTitle>
          <CardDescription>
            Estimated PO value {taxLabel(basis.valueIncludesTax)}, margin dan gross profit {taxLabel(basis.marginIncludesTax)}, PPN {basis.taxRatePercent}%. Contoh: nilai Rp {example.toLocaleString("id-ID")} dengan margin
            10% menghasilkan gross profit Rp {Math.round(example * factor * 0.1).toLocaleString("id-ID")}. Angka yang sudah tersimpan tidak diubah; hanya perhitungan margin yang mengikuti pengaturan ini.
          </CardDescription>
        </CardHeader>
        <CardContent>{mayEdit ? <TaxBasisForm basis={basis} /> : null}</CardContent>
      </Card>
    </>
  );
}
