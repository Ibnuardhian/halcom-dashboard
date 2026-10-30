"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SLA_MAX_DAYS } from "@/domain/requests/sla";
import { BODY_MAX_LENGTH, SUBJECT_MAX_LENGTH, type TemplateTeam } from "@/domain/requests/template";
import { saveTeamSettingAction } from "./actions";

/** SLA dan template email satu tim. "Kembalikan template bawaan" menyimpan template bawaan (SLA tetap seperti yang dipilih). */
export function TeamSettingsForm({ role, label, sla, subject, body, emailTo, emailCc }: { role: TemplateTeam; label: string; sla: string; subject: string; body: string; emailTo: string; emailCc: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveTeamSettingAction, null);
  return (
    <form key={`${sla}|${subject}|${body}|${emailTo}|${emailCc}`} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="role" value={role} />
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor={`${role}-sla`}>SLA tim {label} (hari)</Label>
        <Input id={`${role}-sla`} name="sla" defaultValue={sla} maxLength={12} required inputMode="text" placeholder="contoh: 2-3" />
        <span className="text-xs text-muted-foreground">
          Tulis satu angka (3) atau rentang (2-3, 1-4); paling banyak {SLA_MAX_DAYS} hari. Angka pertama adalah kapan jawaban diharapkan, angka terakhir adalah batas waktunya. Hari kerja, dihitung sejak
          request dibuat; hitungan berhenti selama request menunggu Sales.
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${role}-to`}>Kirim ke (To)</Label>
          <Input id={`${role}-to`} name="emailTo" defaultValue={emailTo} maxLength={2000} autoComplete="off" placeholder={`contoh: ${role === "SOA" ? "soa" : "purchasing"}@halcominovasi.co.id`} />
          <span className="text-xs text-muted-foreground">Pisahkan beberapa alamat dengan koma atau titik koma. Kosong: memakai pengaturan server (EMAIL_TO_HIT*).</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${role}-cc`}>Tembusan (CC)</Label>
          <Input id={`${role}-cc`} name="emailCc" defaultValue={emailCc} maxLength={2000} autoComplete="off" placeholder="contoh: manajer@halcominovasi.co.id" />
          <span className="text-xs text-muted-foreground">Alamat yang sudah ada di To tidak diulang di CC. Dipakai bila To diisi.</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${role}-subject`}>Subjek email</Label>
        <Input id={`${role}-subject`} name="emailSubject" defaultValue={subject} maxLength={SUBJECT_MAX_LENGTH} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${role}-body`}>Isi email</Label>
        <Textarea id={`${role}-body`} name="emailBody" defaultValue={body} maxLength={BODY_MAX_LENGTH} rows={18} required className="font-mono text-sm" />
      </div>
      <FormStatus state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : `Simpan pengaturan ${label}`}
        </Button>
        <Button type="submit" name="restoreDefaults" value="1" variant="outline" formNoValidate disabled={pending}>
          Kembalikan template bawaan
        </Button>
      </div>
    </form>
  );
}
