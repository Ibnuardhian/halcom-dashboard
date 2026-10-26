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

/** One team's SLA and email template. "Restore default template" saves the built-in template (the SLA stays as chosen). */
export function TeamSettingsForm({ role, label, sla, subject, body }: { role: TemplateTeam; label: string; sla: string; subject: string; body: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveTeamSettingAction, null);
  return (
    <form key={`${sla}|${subject}|${body}`} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="role" value={role} />
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor={`${role}-sla`}>SLA of the {label} team (days)</Label>
        <Input id={`${role}-sla`} name="sla" defaultValue={sla} maxLength={12} required inputMode="text" placeholder="contoh: 2-3" />
        <span className="text-xs text-muted-foreground">
          Write one number (3) or a range (2-3, 1-4); at most {SLA_MAX_DAYS} days. The first number is when an answer is expected, the last is the deadline. Working days, counted from when
          the request is created; the clock stands still while the request waits for Sales.
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${role}-subject`}>Email subject</Label>
        <Input id={`${role}-subject`} name="emailSubject" defaultValue={subject} maxLength={SUBJECT_MAX_LENGTH} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${role}-body`}>Email text</Label>
        <Textarea id={`${role}-body`} name="emailBody" defaultValue={body} maxLength={BODY_MAX_LENGTH} rows={18} required className="font-mono text-sm" />
      </div>
      <FormStatus state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : `Save ${label} settings`}
        </Button>
        <Button type="submit" name="restoreDefaults" value="1" variant="outline" formNoValidate disabled={pending}>
          Restore default template
        </Button>
      </div>
    </form>
  );
}
