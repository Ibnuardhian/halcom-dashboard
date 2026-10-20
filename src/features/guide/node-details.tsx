import { ROLE_LABELS, type Role } from "@/domain/access/roles";
import { NODE_KIND_LABELS, type GuideNode } from "@/domain/guide/workflow";
import { KIND_ICONS, ROLE_ICONS } from "./icons";

/** What the chart sends to the browser: everything about a node except its step-by-step instructions. */
export type ChartNode = Omit<GuideNode, "guide">;

/**
 * The facts of one step: who is responsible, what is done, what goes in, what comes out and who receives it. The flowchart shows
 * it in its popover, and the list for small screens shows it open, so the two can never disagree.
 */
export function NodeDetails({ node, headingId }: { node: ChartNode; headingId?: string }) {
  const RoleIcon = ROLE_ICONS[node.role];
  const KindIcon = KIND_ICONS[node.kind];
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium">
        <span className="inline-flex items-center gap-1">
          <RoleIcon aria-hidden className="size-3.5" />
          <span className="sr-only">Responsible role: </span>
          {ROLE_LABELS[node.role]}
        </span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <KindIcon aria-hidden className="size-3.5" />
          <span className="sr-only">Step type: </span>
          {NODE_KIND_LABELS[node.kind]}
        </span>
      </div>
      <h3 id={headingId} className="font-heading text-base leading-snug font-semibold">
        {node.title}
      </h3>
      <dl className="flex flex-col gap-2">
        <Row label="Action">{node.action}</Row>
        <Row label="Required input">{node.input}</Row>
        <Row label="Output">{node.output}</Row>
        <Row label="Next recipient">{node.recipient}</Row>
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export type RoleTag = "own" | "capable" | null;

/** How an account relates to a role: it holds the role, or its permissions cover that role's work, or neither. */
export function roleTagOf(role: Role, ownRoles: readonly Role[], activeRoles: readonly Role[]): RoleTag {
  if (ownRoles.includes(role)) return "own";
  return activeRoles.includes(role) ? "capable" : null;
}

export const ROLE_TAG_LABELS: Record<Exclude<RoleTag, null>, string> = { own: "Your role", capable: "You can act here" };
