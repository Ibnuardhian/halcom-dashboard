import { Badge } from "@/components/ui/badge";
import { SLA_STATE_LABELS, type Sla, type SlaState } from "@/domain/requests/sla";
import { cn } from "@/lib/utils";
import { formatDateOnly } from "./format";

const STYLE: Record<SlaState, { variant: "default" | "secondary" | "outline"; className?: string }> = {
  on_track: { variant: "outline" },
  due_soon: { variant: "secondary", className: "bg-warning text-warning-foreground" },
  overdue: { variant: "secondary", className: "bg-destructive/15 text-destructive" },
  paused: { variant: "outline", className: "text-muted-foreground" },
  met: { variant: "secondary", className: "bg-accent text-accent-foreground" },
  late: { variant: "secondary", className: "bg-destructive/15 text-destructive" },
  none: { variant: "outline", className: "text-muted-foreground" },
};

// Dates are shown as Jakarta calendar dates.
const day = (date: Date) => formatDateOnly(new Date(date.getTime() + 7 * 60 * 60 * 1000));
const sameDay = (a: Date, b: Date) => day(a) === day(b);

/** The reply-by date of a request and where it stands against it. The wording is in the badge, so colour is never the only signal. */
export function SlaBadge({ sla }: { sla: Sla }) {
  if (sla.state === "none") return <span className="text-muted-foreground">–</span>;
  const style = STYLE[sla.state];
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge variant={style.variant} className={cn("whitespace-nowrap", style.className)}>
        {SLA_STATE_LABELS[sla.state]}
      </Badge>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {sameDay(sla.targetAt, sla.dueAt) ? "by " : `${day(sla.targetAt)} – `}
        {day(sla.dueAt)}
      </span>
    </span>
  );
}
