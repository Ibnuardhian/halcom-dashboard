import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "./dashboard-header";
import type { DashboardDefinition } from "./definitions";

/** Renders the widgets whose data source is not built yet without inventing numbers, below any real-data `children`. */
export function PlannedDashboard({ definition, children }: { definition: DashboardDefinition; children?: React.ReactNode }) {
  return (
    <>
      <DashboardHeader title={definition.title} summary={definition.summary} />
      {children}
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Planned widgets</h2>
      <p role="status" className="mb-4 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        These widgets need data that is not captured yet (SLA targets, milestones, comments). They stay empty instead of showing made-up numbers.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {definition.widgets.map((widget) => (
          <li key={widget.title}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <h2>{widget.title}</h2>
                  <Badge variant="outline">No data yet</Badge>
                </CardTitle>
                <CardDescription>{widget.description}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
