import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/domain/access/roles";
import { activeGuideRoles, mayReadRoleSteps, nodesOfRole, visibleLinks } from "@/domain/guide/access";
import { ROLE_GUIDES } from "@/domain/guide/role-guides";
import { GUIDE_LANES, GUIDE_NODES, NODE_KIND_LABELS } from "@/domain/guide/workflow";
import { REQUEST_STATUSES, allowedTransitions, isRetired, REQUEST_STATUS_LABELS, reasonRequired } from "@/domain/requests/status";
import { REQUEST_TYPES } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { Flowchart } from "@/features/guide/flowchart";
import { FlowList } from "@/features/guide/flow-list";
import { GuideLegend } from "@/features/guide/legend";
import { roleTagOf, type ChartNode } from "@/features/guide/node-details";
import { RoleGuide, type RoleSection } from "@/features/guide/role-guide";
import { requireUser } from "@/server/auth/current-user";

export default function GuidePage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Guide />
    </Suspense>
  );
}

async function Guide() {
  // Every signed-in account may read the guide; what it highlights and links to follows the account's own permissions.
  const user = await requireUser();
  const accountRoles = [user.role];
  const activeRoles = activeGuideRoles(accountRoles);

  // The chart gets the facts of each step, never the instructions of a role the account does not hold.
  const chartNodes: ChartNode[] = GUIDE_NODES.map((node) => ({
    id: node.id,
    role: node.role,
    kind: node.kind,
    title: node.title,
    next: node.next,
    col: node.col,
    row: node.row,
    action: node.action,
    input: node.input,
    output: node.output,
    recipient: node.recipient,
  }));
  const sections: RoleSection[] = GUIDE_LANES.map((role) => {
    const info = ROLE_GUIDES[role];
    const detailed = mayReadRoleSteps(role, activeRoles);
    return {
      role,
      tag: roleTagOf(role, accountRoles, activeRoles),
      summary: info.summary,
      detailed,
      reads: detailed ? info.reads : [],
      edits: detailed ? info.edits : [],
      cannot: detailed ? info.cannot : [],
      steps: detailed
        ? nodesOfRole(role).map((node) => ({
            id: node.id,
            title: node.title,
            kind: node.kind,
            kindLabel: NODE_KIND_LABELS[node.kind],
            next: node.next,
            where: node.guide.where,
            prerequisites: node.guide.prerequisites,
            steps: node.guide.steps,
            editable: node.guide.editable,
            handoff: node.guide.handoff,
            links: visibleLinks(node, accountRoles),
          }))
        : [],
    };
  });
  const initialRole = activeRoles.includes(user.role) ? user.role : (activeRoles[0] ?? GUIDE_LANES[0]);

  return (
    <>
      <DashboardHeader
        title="User Guide"
        summary={`Alur proyek dari Sales ke SOA dan Purchasing, dan tugas tiap peran. Langkah milik ${ROLE_LABELS[user.role]} ditandai.`}
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>The workflow</h2>
          </CardTitle>
          <CardDescription>
            Proyek dibuat, lalu BOQ masuk ke SOA dan, setelah selesai, dilanjutkan ke Purchasing sebagai RFQ lalu PO. BOQ boleh dilewati: Sales dapat memulai dengan RFQ. Semua peran dapat membaca semua proyek dan
            request; setiap peran hanya mengedit bagiannya sendiri.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <GuideLegend activeRoles={activeRoles} ownRoles={accountRoles} />
          <div className="hidden md:block">
            <Flowchart nodes={chartNodes} activeRoles={activeRoles} ownRoles={accountRoles} />
          </div>
          <div className="md:hidden">
            <p className="mb-2 text-sm text-muted-foreground">Flowchart membutuhkan layar yang lebih lebar. Berikut langkah yang sama secara berurutan; buka salah satunya untuk melihat detailnya.</p>
            <FlowList nodes={chartNodes} activeRoles={activeRoles} ownRoles={accountRoles} />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Step by step, by role</h2>
          </CardTitle>
          <CardDescription>Pilih sebuah peran. Link hanya membuka halaman yang boleh digunakan akun Anda.</CardDescription>
        </CardHeader>
        <CardContent>
          <RoleGuide sections={sections} initialRole={initialRole} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Request statuses</h2>
          </CardTitle>
          <CardDescription>
            Ke mana sebuah request dapat berpindah berikutnya. SOA memindahkan BOQ, dan Purchasing memindahkan RFQ serta PO, dengan menyeret kartu di board. Membatalkan memerlukan alasan, begitu juga membuka kembali RFQ atau PO
            yang sudah selesai. Pertanyaan dan revisi disampaikan lewat email, agar riwayatnya tetap tersimpan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                {REQUEST_TYPES.map((type) => (
                  <TableHead key={type}>Next for a {type}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {REQUEST_STATUSES.filter((status) => !isRetired(status)).map((status) => (
                <TableRow key={status}>
                  <TableCell className="font-medium">{REQUEST_STATUS_LABELS[status]}</TableCell>
                  {REQUEST_TYPES.map((type) => {
                    const next = allowedTransitions(status, type);
                    return (
                      <TableCell key={type}>
                        {next.length === 0 ? "Tidak ada" : next.map((to) => `${REQUEST_STATUS_LABELS[to]}${reasonRequired(status, to) ? " (dengan alasan)" : ""}`).join(", ")}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">Revision hanya berlaku untuk BOQ. “Waiting for Sales” sudah tidak dipakai: request lama mungkin masih menampilkannya, tetapi tidak ada yang dapat memindahkan request ke status itu.</p>
        </CardContent>
      </Card>
    </>
  );
}
