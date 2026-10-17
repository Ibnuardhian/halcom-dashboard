export function DashboardHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{summary}</p>
    </div>
  );
}
