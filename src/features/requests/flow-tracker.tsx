import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { FLOW_STATE_LABELS, flowSteps, type FlowRequest, type FlowStepState } from "@/domain/requests/flow";
import { cn } from "@/lib/utils";

const TONE: Record<FlowStepState, string> = {
  done: "border-primary/40 bg-accent text-accent-foreground",
  open: "border-primary bg-primary/10",
  waiting: "border-warning bg-warning/15",
  cancelled: "border-dashed text-muted-foreground line-through",
  skipped: "border-dashed text-muted-foreground",
  stopped: "border-dashed text-muted-foreground",
  not_started: "text-muted-foreground",
};

/** BOQ -> RFQ -> PO for one project, with where each step stands. The state is written out, so colour is never the only signal. */
export function FlowTracker({ requests }: { requests: readonly FlowRequest[] }) {
  const steps = flowSteps(requests);
  return (
    <div>
      <ol aria-label="Flow of this project" className="flex flex-wrap items-stretch gap-2">
        {steps.map((step, index) => (
          <li key={step.type} className="flex items-center gap-2">
            <div className={cn("flex min-w-32 flex-col rounded-lg border px-3 py-2", TONE[step.state])}>
              <span className="text-sm font-semibold">{step.type}</span>
              <span className="text-xs">{FLOW_STATE_LABELS[step.state]}</span>
              {step.code ? (
                <Link href={`/request/${step.code}`} className="font-mono text-[11px] text-primary underline-offset-4 hover:underline">
                  {step.code}
                </Link>
              ) : null}
            </div>
            {index < steps.length - 1 ? <ChevronRight aria-hidden className="size-4 text-muted-foreground" /> : null}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">The flow is BOQ, then RFQ, then PO. A BOQ can be skipped by starting with an RFQ.</p>
    </div>
  );
}
