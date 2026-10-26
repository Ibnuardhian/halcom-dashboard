"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createPhaseAction, createSectionAction, saveSectionValuesAction, updatePhaseAction, updateSectionAction } from "./actions";

export type SectionRecord = { id: string; label: string; kind: "TEXT" | "CHOICE"; options: string[]; isActive: boolean };
export type PhaseRecord = { key: string; label: string; isActive: boolean };

/** Admin and Superadmin: a new section for the Technical tab of every project. */
export function NewSectionForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createSectionAction, null);
  const [kind, setKind] = useState("TEXT");
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-section-label">Nama bagian</Label>
          <Input id="new-section-label" name="label" required maxLength={60} placeholder="Pre Assessment" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-section-kind">Bentuk isian</Label>
          <NativeSelect id="new-section-kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="TEXT">Teks bebas</option>
            <option value="CHOICE">Pilihan</option>
          </NativeSelect>
        </div>
      </div>
      {kind === "CHOICE" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-section-options">Pilihan (satu per baris, minimal dua)</Label>
          <Textarea id="new-section-options" name="options" rows={4} />
        </div>
      ) : null}
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Tambah bagian"}
        </Button>
      </div>
    </form>
  );
}

/** One added section: rename it, change its choices, or switch it off. */
export function SectionRow({ section }: { section: SectionRecord }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateSectionAction, null);
  return (
    <li className="py-3">
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={section.id} />
        <div className="flex flex-wrap items-center gap-2">
          <Input name="label" defaultValue={section.label} maxLength={60} required aria-label={`Nama bagian ${section.label}`} className="max-w-sm" />
          <span className="text-xs text-muted-foreground">{section.kind === "CHOICE" ? "Pilihan" : "Teks bebas"}</span>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={section.isActive} /> Dipakai
          </label>
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            Simpan
          </Button>
        </div>
        {section.kind === "CHOICE" ? (
          <Textarea name="options" rows={Math.max(3, section.options.length)} defaultValue={section.options.join("\n")} aria-label={`Pilihan ${section.label}`} className="max-w-sm" />
        ) : null}
        <FormStatus state={state} />
      </form>
    </li>
  );
}

export function NewPhaseForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createPhaseAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-phase-label">Nama phase</Label>
        <Input id="new-phase-label" name="label" required maxLength={60} placeholder="Pre Assessment" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Tambah phase"}
      </Button>
      <div className="basis-full">
        <FormStatus state={state} />
      </div>
    </form>
  );
}

export function PhaseRow({ phase }: { phase: PhaseRecord }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePhaseAction, null);
  return (
    <li className="py-3">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="key" value={phase.key} />
        <Input name="label" defaultValue={phase.label} maxLength={60} required aria-label={`Nama phase ${phase.label}`} className="max-w-sm" />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={phase.isActive} /> Dipakai
        </label>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Simpan
        </Button>
        <div className="basis-full">
          <FormStatus state={state} />
        </div>
      </form>
    </li>
  );
}

/** SOA: the added sections of one project (inside the Technical tab). A switched-off section shows only when it holds something. */
export function ProjectSectionsForm({ projectId, projectCode, sections, values }: { projectId: string; projectCode: string; sections: SectionRecord[]; values: Record<string, string> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSectionValuesAction, null);
  const shown = sections.filter((section) => section.isActive || values[section.id] !== undefined);
  if (shown.length === 0) return null;
  return (
    <form action={action} className="mt-6 flex flex-col gap-3 border-t pt-6">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <h3 className="text-sm font-semibold">Bagian tambahan</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {shown.map((section) => {
          const id = `section-${section.id}`;
          const current = values[section.id] ?? "";
          return (
            <div key={section.id} className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={id}>{section.label}</Label>
              {section.kind === "CHOICE" ? (
                <NativeSelect id={id} name={`section:${section.id}`} defaultValue={current}>
                  <option value="">–</option>
                  {/* A value saved before the list changed stays selectable, so saving does not wipe it. */}
                  {current !== "" && !section.options.includes(current) ? <option value={current}>{current}</option> : null}
                  {section.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Textarea id={id} name={`section:${section.id}`} defaultValue={current} maxLength={4000} rows={3} className="min-h-0" />
              )}
            </div>
          );
        })}
      </div>
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Simpan bagian tambahan"}
        </Button>
      </div>
    </form>
  );
}
