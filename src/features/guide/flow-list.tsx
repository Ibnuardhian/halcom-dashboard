import { UserCheck } from "lucide-react";
import { ROLE_LABELS, type Role } from "@/domain/access/roles";
import { GUIDE_LANES, NODE_KIND_LABELS } from "@/domain/guide/workflow";
import { cn } from "@/lib/utils";
import { KIND_ICONS, ROLE_ICONS } from "./icons";
import { NodeDetails, ROLE_TAG_LABELS, roleTagOf, type ChartNode } from "./node-details";

/**
 * The flowchart as a list, for screens too narrow to read a chart. The steps come in the order of the flow, each one a disclosure
 * that opens the same facts as the chart's popover. A step of a role the account holds is marked with text and the same highlight.
 */
export function FlowList({ nodes, activeRoles, ownRoles }: { nodes: readonly ChartNode[]; activeRoles: readonly Role[]; ownRoles: readonly Role[] }) {
  const ordered = [...nodes].sort(
    (a, b) => a.col - b.col || GUIDE_LANES.indexOf(a.role as (typeof GUIDE_LANES)[number]) - GUIDE_LANES.indexOf(b.role as (typeof GUIDE_LANES)[number]) || (a.row ?? 0) - (b.row ?? 0),
  );
  return (
    <ol aria-label="Workflow steps" data-testid="guide-list" className="flex flex-col gap-2">
      {ordered.map((node, index) => {
        const tag = roleTagOf(node.role, ownRoles, activeRoles);
        const RoleIcon = ROLE_ICONS[node.role];
        const KindIcon = KIND_ICONS[node.kind];
        return (
          <li key={node.id}>
            <details data-active={tag ? "true" : "false"} className={cn("rounded-xl border", tag ? "border-primary bg-primary/10" : "bg-card text-muted-foreground")}>
              <summary className="flex cursor-pointer flex-col gap-1 px-4 py-3 select-none">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
                  <span className="tabular-nums">Step {index + 1}</span>
                  <span className="inline-flex items-center gap-1 uppercase">
                    <RoleIcon aria-hidden className="size-3.5" />
                    {ROLE_LABELS[node.role]}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <KindIcon aria-hidden className="size-3.5" />
                    {NODE_KIND_LABELS[node.kind]}
                  </span>
                  {tag ? (
                    <span className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-px text-[11px] font-medium text-primary-foreground">
                      <UserCheck aria-hidden className="size-3" />
                      {ROLE_TAG_LABELS[tag]}
                    </span>
                  ) : null}
                </span>
                <span className={cn("text-sm font-semibold", tag && "text-foreground")}>{node.title}</span>
                <span className="text-xs">Next: {node.next}</span>
              </summary>
              <div className={cn("border-t px-4 py-3", tag && "text-foreground")}>
                <NodeDetails node={node} />
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
