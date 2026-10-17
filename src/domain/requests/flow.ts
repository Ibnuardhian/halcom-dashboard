import type { RequestStatus } from "./status";
import { REQUEST_TYPES, type RequestType } from "./types";

/** The flow of a project is BOQ -> RFQ -> PO. A BOQ can be skipped: Sales may start with an RFQ. */
export type FlowRequest = { code: string; type: RequestType; status: RequestStatus; flowStopped: boolean };

export type FlowStepState = "done" | "open" | "waiting" | "cancelled" | "skipped" | "stopped" | "not_started";

export const FLOW_STATE_LABELS: Record<FlowStepState, string> = {
  done: "Done",
  open: "In progress",
  waiting: "Waiting for Sales",
  cancelled: "Cancelled",
  skipped: "Skipped",
  stopped: "Not continuing",
  not_started: "Not started",
};

export type FlowStep = { type: RequestType; state: FlowStepState; code: string | null };

const isFinished = (status: RequestStatus) => status === "COMPLETED" || status === "CANCELLED";

/**
 * Where a project stands in BOQ -> RFQ -> PO, from its requests. A step with a request shows that request (an open one
 * first, then a completed one, then a cancelled one). A BOQ with no request while an RFQ or PO exists was skipped. The step
 * after a BOQ or RFQ that Sales decided not to continue from shows "Not continuing".
 */
export function flowSteps(requests: readonly FlowRequest[]): FlowStep[] {
  const steps: FlowStep[] = [];
  for (const type of REQUEST_TYPES) {
    const ofType = requests.filter((request) => request.type === type);
    const chosen = ofType.find((r) => !isFinished(r.status)) ?? ofType.find((r) => r.status === "COMPLETED") ?? ofType[0] ?? null;
    if (chosen) {
      const state: FlowStepState = chosen.status === "COMPLETED" ? "done" : chosen.status === "CANCELLED" ? "cancelled" : chosen.status === "WAITING_FOR_SALES" ? "waiting" : "open";
      steps.push({ type, state, code: chosen.code });
      continue;
    }
    const laterExists = REQUEST_TYPES.slice(REQUEST_TYPES.indexOf(type) + 1).some((later) => requests.some((request) => request.type === later));
    const previous = REQUEST_TYPES[REQUEST_TYPES.indexOf(type) - 1];
    const stopped = previous !== undefined && requests.some((request) => request.type === previous && request.flowStopped);
    steps.push({ type, state: type === "BOQ" && laterExists ? "skipped" : stopped ? "stopped" : "not_started", code: null });
  }
  return steps;
}
