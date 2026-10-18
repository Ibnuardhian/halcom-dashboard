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
    {
      title: "Project progress",
      description: "Milestone status per project. Never inferred from the number of closed tickets alone.",
    },
    { title: "Incoming vs completed", description: "Trend of new and finished requests over time." },
    { title: "SLA state", description: "On track, at risk and overdue counts. Shows “not configured” until SLA targets are approved." },
    { title: "Handover SOA → Purchasing", description: "How long completed BOQs wait before reaching Purchasing as an RFQ." },
  ],
};

/**
 * Planned widgets of the dashboards that have no data source yet. Sales, SOA, Purchasing, Finance, Admin and Superadmin show real
 * numbers (D-023, D-026), so only Management is still here.
 */
export const ROLE_DASHBOARDS: Record<"management", DashboardDefinition> = {
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
