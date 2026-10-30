"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type Role } from "@/domain/access/roles";
import { GUIDE_EDGES, GUIDE_LANES, NODE_KIND_LABELS, type GuideEdge } from "@/domain/guide/workflow";
import { cn } from "@/lib/utils";
import { CHART, chartSize, edgeGeometry, laneRect, nodeRect } from "./geometry";
import { KIND_ICONS, ROLE_ICONS } from "./icons";
import { NodeDetails, roleTagOf, type ChartNode, type RoleTag } from "./node-details";

const SCALES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5] as const;
const DEFAULT_SCALE = 1;
const CARD_WIDTH = 320;
const CARD_GAP = 8;

/** Puts the popover beside its step, inside the screen: below it when there is room (or more room than above), else above. */
function placeCard(card: HTMLElement, anchor: HTMLElement | undefined) {
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(CARD_WIDTH, window.innerWidth - 16);
  card.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  const below = window.innerHeight - rect.bottom;
  const placeBelow = below >= 380 || below >= rect.top;
  card.style.top = placeBelow ? `${rect.bottom + CARD_GAP}px` : "";
  card.style.bottom = placeBelow ? "" : `${window.innerHeight - rect.top + CARD_GAP}px`;
  // Where neither side has room for the whole card, it scrolls inside itself instead of running off the screen.
  const room = (placeBelow ? below : rect.top) - CARD_GAP - 8;
  card.style.maxHeight = `${Math.max(160, room)}px`;
}
/** The pointer may rest this long outside a node and its popover before the popover closes, so the mouse can travel between them. */
const HIDE_DELAY_MS = 150;

const SHORT_TAG: Record<Exclude<RoleTag, null>, string> = { own: "Your role", capable: "Can act" };

type Props = {
  nodes: readonly ChartNode[];
  /** Roles whose nodes and interactions are highlighted. */
  activeRoles: readonly Role[];
  /** The role(s) of the signed-in account itself; the rest of the active roles are ones its permissions cover. */
  ownRoles: readonly Role[];
};

/**
 * The workflow as a flowchart: one lane per role, nodes in order of the flow, arrows for handoffs. Colour marks only the signed-in
 * account's roles; a node's kind, its role and its next recipient are always written out. A node opens its details on hover and focus,
 * and pins them on click, tap or Enter; Escape closes. The chart scrolls and zooms inside its frame. Below `md` the page shows the list
 * instead (see FlowList).
 */
export function Flowchart({ nodes, activeRoles, ownRoles }: Props) {
  const size = chartSize();
  const [scale, setScale] = useState<number>(DEFAULT_SCALE);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nodeButtons = useRef(new Map<string, HTMLButtonElement>());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean; active: boolean } | null>(null);
  const restoringFocus = useRef(false);
  const baseId = useId();

  const cardEl = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), []);

  const shownId = hoverId ?? pinnedId;
  const shown = shownId ? nodes.find((node) => node.id === shownId) : undefined;

  // The popover is fixed to the screen, so the chart's own scrolling cannot clip it. It follows its step while the page or the chart scrolls.
  useEffect(() => {
    if (!shownId) return;
    const follow = () => {
      if (cardEl.current) placeCard(cardEl.current, nodeButtons.current.get(shownId));
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [shownId]);
  const cardId = `${baseId}-card`;
  const headingId = `${baseId}-card-title`;
  const isActive = (role: Role) => activeRoles.includes(role);

  function cancelHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }
  function show(id: string) {
    cancelHide();
    setHoverId(id);
  }
  function scheduleHide() {
    cancelHide();
    hideTimer.current = setTimeout(() => setHoverId(null), HIDE_DELAY_MS);
  }
  function closeAll(returnFocusTo?: string | null) {
    cancelHide();
    setHoverId(null);
    setPinnedId(null);
    if (returnFocusTo) {
      // Putting focus back on the step must not open its details again, which is what focusing a step normally does.
      restoringFocus.current = true;
      nodeButtons.current.get(returnFocusTo)?.focus();
      restoringFocus.current = false;
    }
  }

  function zoomBy(direction: 1 | -1) {
    setScale((current) => {
      const index = SCALES.findIndex((step) => step >= current - 0.001);
      const next = Math.min(SCALES.length - 1, Math.max(0, (index === -1 ? SCALES.length - 1 : index) + direction));
      return SCALES[next]!;
    });
  }
  function fit() {
    const width = scroller.current?.clientWidth ?? size.width;
    setScale(Math.min(1.5, Math.max(0.4, Math.floor((width / size.width) * 20) / 20)));
    scroller.current?.scrollTo({ left: 0 });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-guide-node],[data-guide-card],button")) return;
    const el = scroller.current;
    if (!el) return;
    drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false, active: true };
    el.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const el = scroller.current;
    if (!state || !state.active || !el) return;
    // No button held any more (released outside the window, or the release was missed): the drag is over.
    if (event.buttons === 0) {
      state.active = false;
      return;
    }
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;
    el.scrollLeft = state.left - dx;
    el.scrollTop = state.top - dy;
  }
  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    // The drag ends here; `moved` is kept only so the click that follows a drag does not close a pinned popover.
    if (drag.current) drag.current.active = false;
    if (scroller.current?.hasPointerCapture(event.pointerId)) scroller.current.releasePointerCapture(event.pointerId);
  }
  function onClick(event: React.MouseEvent<HTMLDivElement>) {
    // A click on empty chart closes a pinned popover, unless it was the end of a drag.
    if (drag.current?.moved) return;
    if (!(event.target as HTMLElement).closest("[data-guide-node],[data-guide-card]")) closeAll();
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && (shownId || pinnedId)) {
      event.stopPropagation();
      closeAll(pinnedId ?? shownId);
      return;
    }
    // Zoom keys work while the chart frame itself has focus (not while typing in a control inside it).
    if (event.target !== event.currentTarget) return;
    if (event.key === "+" || event.key === "=") zoomBy(1);
    else if (event.key === "-") zoomBy(-1);
    else if (event.key === "0") setScale(1);
  }

  const innerWidth = size.width * scale;
  const innerHeight = size.height * scale;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Zoom" className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" aria-label="Zoom out" onClick={() => zoomBy(-1)} disabled={scale <= SCALES[0]}>
            <Minus aria-hidden />
          </Button>
          <span aria-live="polite" className="min-w-12 text-center text-sm tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <Button type="button" variant="outline" size="icon" aria-label="Zoom in" onClick={() => zoomBy(1)} disabled={scale >= SCALES[SCALES.length - 1]!}>
            <Plus aria-hidden />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Fit chart to width" onClick={fit}>
            <Maximize2 aria-hidden />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Reset zoom to 100%" onClick={() => setScale(1)}>
            <RotateCcw aria-hidden />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Seret atau scroll untuk bergeser. Arahkan kursor, fokus, atau klik sebuah langkah untuk melihat detailnya; tekan Escape untuk menutupnya.</p>
      </div>

      <div
        ref={scroller}
        role="region"
        aria-label="Workflow flowchart. Scrollable; zoom with the buttons, or + and - when this frame has focus."
        tabIndex={0}
        data-testid="guide-chart"
        className="max-h-[75vh] cursor-grab overflow-auto rounded-xl border bg-card outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <div className="relative" style={{ width: innerWidth, height: innerHeight }}>
          <div className="absolute top-0 left-0" style={{ width: size.width, height: size.height, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
            {GUIDE_LANES.map((role) => (
              <Lane key={role} role={role} active={isActive(role)} tag={roleTagOf(role, ownRoles, activeRoles)} />
            ))}
            <svg width={size.width} height={size.height} className="pointer-events-none absolute top-0 left-0" aria-hidden focusable="false">
              <defs>
                <marker id="guide-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" className="fill-primary" />
                </marker>
                <marker id="guide-arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground/60" />
                </marker>
              </defs>
              {GUIDE_EDGES.map((edge) => (
                <Edge key={`${edge.from}-${edge.to}`} edge={edge} active={edgeIsActive(edge, nodes, activeRoles)} />
              ))}
            </svg>
            {nodes.map((node) => (
              <NodeButton
                key={node.id}
                node={node}
                tag={roleTagOf(node.role, ownRoles, activeRoles)}
                expanded={pinnedId === node.id}
                describedBy={shownId === node.id ? cardId : undefined}
                register={(el) => {
                  if (el) nodeButtons.current.set(node.id, el);
                  else nodeButtons.current.delete(node.id);
                }}
                onShow={() => show(node.id)}
                onFocusShow={() => {
                  if (!restoringFocus.current) show(node.id);
                }}
                onHide={scheduleHide}
                onToggle={() => {
                  cancelHide();
                  // A second click or tap closes the details, including the hover state that a touch screen leaves behind.
                  if (pinnedId === node.id) {
                    setPinnedId(null);
                    setHoverId(null);
                  } else {
                    setPinnedId(node.id);
                  }
                }}
              />
            ))}
          </div>

          {shown ? (
            <div
              key={shown.id}
              ref={(el) => {
                cardEl.current = el;
                if (el) placeCard(el, nodeButtons.current.get(shown.id));
              }}
              id={cardId}
              role="dialog"
              aria-modal="false"
              aria-labelledby={headingId}
              data-guide-card
              data-testid="guide-card"
              style={{ width: CARD_WIDTH }}
              className="fixed z-30 max-w-[calc(100vw-1rem)] cursor-default overflow-y-auto rounded-xl border bg-card p-4 pr-10 shadow-lg ring-1 ring-foreground/10"
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleHide}
            >
              <Button type="button" variant="ghost" size="icon" className="absolute top-1.5 right-1.5" aria-label="Close details" onClick={() => closeAll(shown.id)}>
                <X aria-hidden />
              </Button>
              <NodeDetails node={shown} headingId={headingId} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function edgeIsActive(edge: GuideEdge, nodes: readonly ChartNode[], activeRoles: readonly Role[]): boolean {
  return [edge.from, edge.to].some((id) => {
    const node = nodes.find((candidate) => candidate.id === id);
    return node ? activeRoles.includes(node.role) : false;
  });
}

function Lane({ role, active, tag }: { role: Role; active: boolean; tag: RoleTag }) {
  const rect = laneRect(role);
  const Icon = ROLE_ICONS[role];
  return (
    <div
      data-testid={`guide-lane-${role}`}
      data-active={active ? "true" : "false"}
      className={cn("absolute border-y", active ? "border-primary/40 bg-primary/10" : "border-border bg-muted/30")}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <div className={cn("flex h-full flex-col justify-center gap-1 px-3", active ? "text-foreground" : "text-muted-foreground")} style={{ width: CHART.laneLabelWidth }}>
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Icon aria-hidden className="size-4 shrink-0" />
          {ROLE_LABELS[role]}
        </span>
        {tag ? (
          <span className="inline-flex w-fit items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
            <UserCheck aria-hidden className="size-3" />
            {SHORT_TAG[tag]}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Edge({ edge, active }: { edge: GuideEdge; active: boolean }) {
  const { path, label: labelAt, labelAnchor } = edgeGeometry(edge);
  return (
    <g data-edge={`${edge.from}>${edge.to}`} data-active={active ? "true" : "false"}>
      <path
        d={path}
        fill="none"
        strokeLinejoin="round"
        strokeWidth={edge.style === "handoff" ? 3 : 1.75}
        strokeDasharray={edge.style === "support" ? "7 5" : undefined}
        className={active ? "stroke-primary" : "stroke-muted-foreground/60"}
        markerEnd={`url(#${active ? "guide-arrow-active" : "guide-arrow-muted"})`}
      />
      {edge.label && labelAt ? (
        <text x={labelAt.x} y={labelAt.y} textAnchor={labelAnchor} dominantBaseline="middle" className="fill-muted-foreground text-[11px]" style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 4 }}>
          {edge.label}
        </text>
      ) : null}
    </g>
  );
}

function NodeButton({
  node,
  tag,
  expanded,
  describedBy,
  register,
  onShow,
  onFocusShow,
  onHide,
  onToggle,
}: {
  node: ChartNode;
  tag: RoleTag;
  expanded: boolean;
  describedBy: string | undefined;
  register: (el: HTMLButtonElement | null) => void;
  onShow: () => void;
  onFocusShow: () => void;
  onHide: () => void;
  onToggle: () => void;
}) {
  const rect = nodeRect(node);
  const RoleIcon = ROLE_ICONS[node.role];
  const KindIcon = KIND_ICONS[node.kind];
  const active = tag !== null;
  return (
    <button
      ref={register}
      type="button"
      data-guide-node
      data-node-id={node.id}
      data-active={active ? "true" : "false"}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      aria-describedby={describedBy}
      className={cn(
        "absolute flex cursor-pointer flex-col items-stretch justify-between rounded-lg border px-2.5 py-2 text-left outline-offset-2 transition-opacity focus-visible:outline-2 focus-visible:outline-ring",
        active ? "border-primary bg-primary/10 text-foreground shadow-sm ring-2 ring-primary/40" : "border-border bg-background text-muted-foreground opacity-75 hover:opacity-100 focus-visible:opacity-100",
        (node.kind === "readonly" || node.kind === "setup") && "border-dashed",
        expanded && "ring-2 ring-foreground/40",
      )}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onMouseEnter={onShow}
      onMouseLeave={onHide}
      onFocus={onFocusShow}
      onBlur={onHide}
      onClick={onToggle}
    >
      <span className="flex items-center justify-between gap-1 text-[11px] font-semibold">
        <span className="inline-flex items-center gap-1">
          <RoleIcon aria-hidden className="size-3 shrink-0" />
          {ROLE_LABELS[node.role]}
        </span>
        {tag ? (
          <span className="inline-flex items-center gap-0.5 rounded bg-primary px-1 py-px text-[10px] font-medium tracking-normal text-primary-foreground normal-case">
            <UserCheck aria-hidden className="size-2.5" />
            {SHORT_TAG[tag]}
          </span>
        ) : null}
      </span>
      <span className="line-clamp-2 text-[13px] leading-tight font-semibold">{node.title}</span>
      <span className="flex items-center gap-1 text-[11px]">
        <KindIcon aria-hidden className="size-3 shrink-0" />
        <span className="shrink-0">{NODE_KIND_LABELS[node.kind]}</span>
        <span aria-hidden>·</span>
        <span className="truncate">
          <span className="sr-only">Next: </span>
          <span aria-hidden>→ </span>
          {node.next}
        </span>
      </span>
    </button>
  );
}
