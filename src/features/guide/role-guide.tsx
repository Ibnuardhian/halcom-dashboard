"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { UserCheck } from "lucide-react";
import { ROLE_LABELS, type Role } from "@/domain/access/roles";
import { cn } from "@/lib/utils";
import { KIND_ICONS, ROLE_ICONS } from "./icons";
import { ROLE_TAG_LABELS, type RoleTag } from "./node-details";
import type { NodeKind } from "@/domain/guide/workflow";

export type StepView = {
  id: string;
  title: string;
  kind: NodeKind;
  kindLabel: string;
  next: string;
  where: string;
  prerequisites: readonly string[];
  steps: readonly string[];
  editable: readonly string[];
  handoff: string;
  links: readonly { label: string; href: string }[];
};

export type RoleSection = {
  role: Role;
  tag: RoleTag;
  summary: string;
  /** False for Admin and Superadmin when the account does not hold that role: only the summary is shown. */
  detailed: boolean;
  reads: readonly string[];
  edits: readonly string[];
  cannot: readonly string[];
  steps: readonly StepView[];
};

/**
 * Step-by-step instructions, one tab per role. Reading a project is shared by every role; editing belongs to the role that owns the
 * field, so each tab keeps "Can read", "Can edit" and "Cannot" apart. Links appear only for pages the account may open.
 */
export function RoleGuide({ sections, initialRole }: { sections: readonly RoleSection[]; initialRole: Role }) {
  const [selected, setSelected] = useState<Role>(initialRole);
  const tabs = useRef(new Map<Role, HTMLButtonElement>());
  const current = sections.find((section) => section.role === selected) ?? sections[0]!;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = sections.findIndex((section) => section.role === selected);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % sections.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + sections.length) % sections.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sections.length - 1;
    else return;
    event.preventDefault();
    const role = sections[next]!.role;
    setSelected(role);
    tabs.current.get(role)?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Guide by role" className="flex gap-1 overflow-x-auto border-b pb-px" onKeyDown={onKeyDown}>
        {sections.map((section) => {
          const Icon = ROLE_ICONS[section.role];
          const isSelected = section.role === current.role;
          return (
            <button
              key={section.role}
              ref={(el) => {
                if (el) tabs.current.set(section.role, el);
                else tabs.current.delete(section.role);
              }}
              type="button"
              role="tab"
              id={`guide-tab-${section.role}`}
              aria-selected={isSelected}
              aria-controls={`guide-panel-${section.role}`}
              tabIndex={isSelected ? 0 : -1}
              data-active={section.tag ? "true" : "false"}
              onClick={() => setSelected(section.role)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
                isSelected ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:bg-muted",
                section.tag && "bg-primary/10",
              )}
            >
              <Icon aria-hidden className="size-4" />
              {ROLE_LABELS[section.role]}
              {section.tag ? (
                <span className="inline-flex items-center gap-0.5 rounded bg-primary px-1.5 py-px text-[11px] font-medium text-primary-foreground">
                  <UserCheck aria-hidden className="size-3" />
                  {section.tag === "own" ? "You" : "Can act"}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`guide-panel-${current.role}`} aria-labelledby={`guide-tab-${current.role}`} tabIndex={0} className="flex flex-col gap-4 outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
        <div>
          <h3 className="font-heading text-lg font-semibold">
            {ROLE_LABELS[current.role]}
            {current.tag ? <span className="ml-2 text-sm font-normal text-muted-foreground">({ROLE_TAG_LABELS[current.tag]})</span> : null}
          </h3>
          <p className="text-muted-foreground">{current.summary}</p>
        </div>

        {current.detailed ? (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Bullets title="Can read" items={current.reads} />
              <Bullets title="Can edit" items={current.edits} empty="Tidak ada: peran ini hanya membaca." />
              <Bullets title="Cannot" items={current.cannot} />
            </div>
            <ol className="flex flex-col gap-3" aria-label={`${ROLE_LABELS[current.role]} steps`}>
              {current.steps.map((step, index) => (
                <StepCard key={step.id} step={step} index={index} />
              ))}
            </ol>
          </>
        ) : (
          <p role="note" className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
            Langkah detail untuk peran ini hanya ditampilkan kepada yang memegang peran tersebut.
          </p>
        )}
      </div>
    </div>
  );
}

function Bullets({ title, items, empty }: { title: string; items: readonly string[]; empty?: string }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty ?? "Nothing."}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-4 text-sm">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StepCard({ step, index }: { step: StepView; index: number }) {
  const KindIcon = KIND_ICONS[step.kind];
  return (
    <li className="rounded-xl border bg-card p-4" data-step={step.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex size-6 items-center justify-center rounded-full border text-xs font-semibold tabular-nums" aria-hidden>
          {index + 1}
        </span>
        <h4 className="font-heading text-base font-semibold">
          <span className="sr-only">Step {index + 1}: </span>
          {step.title}
        </h4>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <KindIcon aria-hidden className="size-3.5" />
          {step.kindLabel}
        </span>
      </div>
      <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
        <Item label="Where">{step.where}</Item>
        <Item label="Next">{step.next}</Item>
        <Item label="Before you start">
          <List items={step.prerequisites} />
        </Item>
        <Item label="Fields you can edit">
          <List items={step.editable} />
        </Item>
      </dl>
      <div className="mt-3 text-sm">
        <h5 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Steps</h5>
        <ol className="list-decimal space-y-1 pl-5">
          {step.steps.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </div>
      <p className="mt-3 text-sm">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Handoff: </span>
        {step.handoff}
      </p>
      {step.links.length > 0 ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Open</span>
          {step.links.map((link) => (
            <Link key={link.href} href={link.href} className="text-primary underline-offset-4 hover:underline">
              {link.label}
            </Link>
          ))}
        </p>
      ) : null}
    </li>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function List({ items }: { items: readonly string[] }) {
  return items.length === 1 ? (
    <>{items[0]}</>
  ) : (
    <ul className="list-disc space-y-0.5 pl-4">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
