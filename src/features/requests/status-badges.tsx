import { Badge } from "@/components/ui/badge";
import { PROJECT_STAGE_LABELS, type ProjectStage } from "@/domain/projects/pipeline";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "@/domain/requests/status";
import { PROJECT_STATUS_LABELS, type ProjectStatus, type RequestType } from "@/domain/requests/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<RequestStatus, { variant: "default" | "secondary" | "outline"; className?: string }> = {
  SUBMITTED: { variant: "outline" },
  IN_PROGRESS: { variant: "default" },
  // Amber is reserved for states that need attention (waiting on Sales).
  WAITING_FOR_SALES: { variant: "secondary", className: "bg-warning text-warning-foreground" },
  COMPLETED: { variant: "secondary", className: "bg-accent text-accent-foreground" },
  CANCELLED: { variant: "outline", className: "text-muted-foreground line-through" },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <Badge variant={style.variant} className={cn(style.className)}>
      {REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TypeBadge({ type }: { type: RequestType }) {
  return (
    <Badge variant="secondary" className="font-mono">
      {type}
    </Badge>
  );
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={status === "ACTIVE" ? "default" : "outline"}>{PROJECT_STATUS_LABELS[status]}</Badge>;
}

const STAGE_STYLE: Record<ProjectStage, { variant: "default" | "secondary" | "outline"; className?: string }> = {
  NEW_OPPORTUNITY: { variant: "outline" },
  ASSESSMENT: { variant: "secondary" },
  SIZING_BOQ: { variant: "secondary" },
  POC: { variant: "secondary" },
  QUOTATION: { variant: "default" },
  NEGOTIATION: { variant: "default" },
  WON: { variant: "secondary", className: "bg-accent text-accent-foreground" },
  LOST: { variant: "outline", className: "text-muted-foreground" },
};

export function StageBadge({ stage }: { stage: ProjectStage }) {
  const style = STAGE_STYLE[stage];
  return (
    <Badge variant={style.variant} className={cn(style.className)}>
      {PROJECT_STAGE_LABELS[stage]}
    </Badge>
  );
}
