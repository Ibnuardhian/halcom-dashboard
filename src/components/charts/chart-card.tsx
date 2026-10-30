import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** The frame every chart sits in: a title that says what is measured, one line of explanation, then the chart. */
export function ChartCard({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">
          <h3>{title}</h3>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ChartEmpty({ children = "Belum ada data." }: { children?: React.ReactNode }) {
  return (
    <p role="status" className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** Categorical colour for the n-th slice (fixed order, never cycled); folded and unset slices use the neutral colour. */
export function seriesColor(index: number, neutral = false): string {
  return neutral || index >= 8 ? "var(--viz-other)" : `var(--viz-${index + 1})`;
}
