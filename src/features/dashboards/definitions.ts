import type { DashboardKey } from "@/domain/access/dashboards";

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
  summary: "Project progress and request statistics visible to everyone who signs in.",
  widgets: [
    { title: "Active projects", description: "Projects with work still open." },
    {
      title: "Project progress",
      description: "Milestone status per project. Never inferred from the number of closed tickets alone.",
    },
    { title: "Open tickets by type and team", description: "BOQ, RFQ and PO requests split by owning team." },
    { title: "Incoming vs completed", description: "Trend of new and finished requests over time." },
    { title: "SLA state", description: "On track, at risk and overdue counts. Shows “not configured” until SLA targets are approved." },
    { title: "Handover SOA → Purchasing", description: "How long completed BOQs wait before reaching Purchasing as an RFQ." },
  ],
};

type RoleDashboardKey = Exclude<DashboardKey, "admin" | "superadmin">;

export const ROLE_DASHBOARDS: Record<RoleDashboardKey, DashboardDefinition> = {
  sales: {
    title: "Sales dashboard",
    summary: "Your projects and requests to SOA and Purchasing.",
    widgets: [
      { title: "My requests", description: "BOQ, RFQ and PO requests you submitted, with current status and owner." },
      { title: "Waiting for Sales", description: "Clarifications requested from you, oldest first." },
      { title: "My project progress", description: "Milestones of the projects you own." },
      { title: "Email actions", description: "[HITBOQ], [HITRFQ] and [HITPO] emails prepared but not yet opened or sent." },
    ],
  },
  soa: {
    title: "SOA dashboard",
    summary: "BOQ requests from Sales and their handover to Purchasing.",
    widgets: [
      { title: "Incoming BOQ requests", description: "[HITBOQ] requests waiting for triage." },
      { title: "Assigned to me", description: "BOQ work you own, with age and SLA state." },
      { title: "Waiting for Sales", description: "BOQs paused for missing information." },
      {
        title: "Ready for handover",
        description: "Completed BOQs to send to Purchasing as a [HITRFQ] request.",
      },
    ],
  },
  purchasing: {
    title: "Purchasing dashboard",
    summary: "RFQ and PO requests from Sales and from SOA handovers.",
    widgets: [
      { title: "Incoming requests", description: "[HITRFQ] and [HITPO] requests not yet picked up." },
      { title: "Handed over from SOA", description: "Requests that arrived with a completed BOQ." },
      { title: "Waiting for vendor", description: "Requests blocked on external input, with the reason." },
      { title: "PO references", description: "Purchasing and PO numbers recorded on requests." },
    ],
  },
  finance: {
    title: "Finance dashboard",
    summary: "Read-only cross-check of projects, BOQs and purchasing references.",
    widgets: [
      { title: "Cross-check list", description: "Projects with their BOQ and purchasing/PO references." },
      { title: "Missing references", description: "Requests without a PO or purchasing reference yet." },
      { title: "Estimated values", description: "Project values, where entered and permitted for Finance." },
      { title: "Export", description: "Excel (.xlsx) export of the cross-check list." },
    ],
  },
  management: {
    title: "Management dashboard",
    summary: "Operational health across teams.",
    widgets: [
      { title: "Open tickets by team", description: "Workload per team and per assignee." },
      { title: "SLA at risk and overdue", description: "Tickets needing attention, with drill-down. Shows “not configured” until targets exist." },
      { title: "Bottlenecks", description: "Time spent per status, and delay reasons." },
      { title: "Delayed or blocked projects", description: "Projects with work waiting on someone." },
    ],
  },
};
