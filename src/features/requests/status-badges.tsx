import { Badge } from "@/components/ui/badge";
import { PROGRESS_LABELS, TRACK_STATUS_LABELS, type ProjectProgress, type TrackStatus } from "@/domain/projects/progress";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "@/domain/requests/status";
import type { RequestType } from "@/domain/requests/types";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<RequestStatus, { variant: "default" | "secondary" | "outline"; className?: string }> = {
  SUBMITTED: { variant: "outline" },
  IN_PROGRESS: { variant: "default" },
  // Amber is for states that need attention: a revision in progress (and the retired waiting status of older requests).
  WAITING_FOR_SALES: { variant: "secondary", className: "bg-warning text-warning-foreground" },
  COMPLETED: { variant: "secondary", className: "bg-accent text-accent-foreground" },
  REVISION: { variant: "secondary", className: "bg-warning text-warning-foreground" },
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

const PROGRESS_STYLE: Record<ProjectProgress, { variant: "default" | "secondary" | "outline"; className?: string }> = {
  QUALIFY: { variant: "outline" },
  UNDERSTAND: { variant: "outline" },
  PROPOSE: { variant: "secondary" },
  NEGOTIATE: { variant: "default" },
  NEGOTIATE_FU: { variant: "default" },
  AGREE: { variant: "default" },
  CLOSED_WON: { variant: "secondary", className: "bg-accent text-accent-foreground" },
  CLOSED_LOST: { variant: "outline", className: "text-muted-foreground" },
};

/** Sales' Progress, in the wording of their sheet ("30% - Propose"). */
export function ProgressBadge({ progress }: { progress: ProjectProgress }) {
  const style = PROGRESS_STYLE[progress];
  return (
    <Badge variant={style.variant} className={cn("whitespace-nowrap", style.className)}>
      {PROGRESS_LABELS[progress]}
    </Badge>
  );
}

/** Amber is kept for the states that need attention: a blocked project, or one on hold. */
export function TrackStatusBadge({ status }: { status: TrackStatus }) {
  const attention = status === "BLOCK" || status === "ON_HOLD";
  return (
    <Badge variant={attention ? "secondary" : status === "DONE" ? "outline" : "default"} className={cn("whitespace-nowrap", attention && "bg-warning text-warning-foreground")}>
      {TRACK_STATUS_LABELS[status]}
    </Badge>
  );
}
