import { UserCheck } from "lucide-react";
import { ROLE_LABELS, type Role } from "@/domain/access/roles";
import { GUIDE_LANES, NODE_KIND_LABELS, type NodeKind } from "@/domain/guide/workflow";
import { cn } from "@/lib/utils";
import { KIND_ICONS, ROLE_ICONS } from "./icons";
import { roleTagOf } from "./node-details";

const KINDS: readonly NodeKind[] = ["action", "handoff", "decision", "readonly", "setup"];

/**
 * Always shown with the chart. Colour has one meaning on the chart: the role(s) of the signed-in account. Everything else (a step's
 * role, its kind, how work moves) is written or drawn with text, icons and line styles.
 */
export function GuideLegend({ activeRoles, ownRoles }: { activeRoles: readonly Role[]; ownRoles: readonly Role[] }) {
  return (
    <section aria-label="Legend" data-testid="guide-legend" className="grid gap-4 rounded-xl border bg-card p-4 text-sm md:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Colour = your role</h3>
        <p className="flex items-start gap-2">
          <span aria-hidden className="mt-0.5 inline-flex h-5 w-8 shrink-0 items-center justify-center rounded border border-primary bg-primary/10 ring-2 ring-primary/40">
            <UserCheck className="size-3" />
          </span>
          <span>
            <strong>Disorot</strong>: peran Anda (tag “Your role”), atau peran lain yang juga tercakup oleh permission Anda (tag “Can act”).
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span aria-hidden className="mt-0.5 inline-block h-5 w-8 shrink-0 rounded border border-border bg-background opacity-75" />
          <span>
            <strong>Diredupkan</strong>: peran lain. Tetap terlihat agar Anda tahu dari mana pekerjaan datang dan ke mana perginya.
          </span>
        </p>
        <p className="text-xs text-muted-foreground">Status request tertulis di halamannya, bukan lewat warna.</p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Roles</h3>
        <ul className="flex flex-col gap-1">
          {GUIDE_LANES.map((role) => {
            const Icon = ROLE_ICONS[role];
            const tag = roleTagOf(role, ownRoles, activeRoles);
            return (
              <li key={role} data-active={tag ? "true" : "false"} className={cn("flex items-center gap-2", tag ? "font-semibold" : "text-muted-foreground")}>
                <Icon aria-hidden className="size-4 shrink-0" />
                {ROLE_LABELS[role]}
                {tag ? <span className="rounded bg-primary px-1.5 py-px text-[11px] font-medium text-primary-foreground">{tag === "own" ? "You" : "Can act"}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Arrows</h3>
        <ul className="flex flex-col gap-2">
          <Line label="Handoff: pekerjaan berpindah ke peran lain" strokeWidth={3} />
          <Line label="Berlanjut di peran yang sama" strokeWidth={1.75} />
          <Line label="Informasi atau setup: tidak ada yang diserahkan" strokeWidth={1.75} dash="7 5" />
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Step types</h3>
        <ul className="flex flex-col gap-1">
          {KINDS.map((kind) => {
            const Icon = KIND_ICONS[kind];
            return (
              <li key={kind} className="flex items-center gap-2">
                <Icon aria-hidden className="size-4 shrink-0" />
                {NODE_KIND_LABELS[kind]}
                {kind === "readonly" || kind === "setup" ? <span className="text-xs text-muted-foreground">(dashed outline)</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Line({ label, strokeWidth, dash }: { label: string; strokeWidth: number; dash?: string }) {
  return (
    <li className="flex items-center gap-2">
      <svg aria-hidden width="40" height="12" className="shrink-0 text-muted-foreground">
        <line x1="2" y1="6" x2="30" y2="6" stroke="currentColor" strokeWidth={strokeWidth} strokeDasharray={dash} />
        <path d="M28,2 L38,6 L28,10 z" fill="currentColor" />
      </svg>
      <span>{label}</span>
    </li>
  );
}
