import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "./dashboard-header";
import type { DashboardDefinition } from "./definitions";

/** Renders a dashboard whose data source (projects and tickets) is not built yet, without inventing numbers. */
export function PlannedDashboard({ definition }: { definition: DashboardDefinition }) {
  return (
    <>
      <DashboardHeader title={definition.title} summary={definition.summary} />
      <p role="status" className="mb-4 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        No data yet. The project and ticket modules are not built, so these widgets stay empty instead of showing made-up numbers.
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
