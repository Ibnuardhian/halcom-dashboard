export type WidgetDefinition = { title: string; description: string };

export type DashboardDefinition = {
  title: string;
  summary: string;
  widgets: readonly WidgetDefinition[];
};

/**
 * What each dashboard will show, taken from the product brief (§5 roles, §9 analytics).
 * Every widget renders as "no data yet" until the project and ticket modules exist:
 * the system must not fabricate numbers (brief §18 "No fabricated analytics").
 */
export const SHARED_DASHBOARD: DashboardDefinition = {
  title: "Overview",
  summary: "Statistik progress proyek dan request, terlihat oleh siapa saja yang masuk ke aplikasi.",
  widgets: [
    {
      title: "Project progress",
      description: "Status milestone per proyek. Tidak pernah disimpulkan hanya dari jumlah tiket yang ditutup.",
    },
    { title: "Incoming vs completed", description: "Tren request baru dan request yang selesai dari waktu ke waktu." },
    { title: "SLA state", description: "Jumlah yang on track, berisiko, dan terlambat. Menampilkan “belum diatur” sampai target SLA disetujui." },
    { title: "Handover SOA → Purchasing", description: "Berapa lama BOQ yang sudah selesai menunggu sebelum sampai ke Purchasing sebagai RFQ." },
  ],
};

/**
 * Planned widgets of the dashboards that have no data source yet. Sales, SOA, Purchasing, Finance, Admin and Superadmin show real
 * numbers (D-023, D-026), so only Management is still here.
 */
export const ROLE_DASHBOARDS: Record<"management", DashboardDefinition> = {
  management: {
    title: "Management dashboard",
    summary: "Kesehatan operasional di semua tim.",
    widgets: [
      { title: "Open tickets by team", description: "Beban kerja per tim dan per penanggung jawab." },
      { title: "SLA at risk and overdue", description: "Tiket yang perlu perhatian, dengan drill-down. Menampilkan “belum diatur” sampai target ditetapkan." },
      { title: "Bottlenecks", description: "Waktu yang dihabiskan per status, dan alasan keterlambatan." },
      { title: "Delayed or blocked projects", description: "Proyek dengan pekerjaan yang masih menunggu seseorang." },
    ],
  },
};
