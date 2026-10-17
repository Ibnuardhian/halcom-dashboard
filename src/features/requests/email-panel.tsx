"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type CopyState = "idle" | "copied" | "failed";

function CopyButton({ text, label, disabled }: { text: string; label: string; disabled?: boolean }) {
  const [state, setState] = useState<CopyState>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Clipboard blocked (permissions, insecure origin): the text stays selectable in the box.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={copy} aria-label={`Copy ${label}`}>
      {state === "copied" ? <Check aria-hidden data-icon="inline-start" /> : <Copy aria-hidden data-icon="inline-start" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}
    </Button>
  );
}

function CopyField({
  id,
  label,
  value,
  multiline,
  missing,
}: {
  id: string;
  label: string;
  value: string;
  multiline?: boolean;
  /** Shown instead of the value when it cannot be produced (for example missing configuration). */
  missing?: string;
}) {
  const shared = cn(
    "w-full rounded-lg border border-input bg-muted/40 px-2.5 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    missing && "border-warning",
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <CopyButton text={value} label={label} disabled={Boolean(missing) || value === ""} />
      </div>
      {multiline ? (
        <textarea id={id} readOnly value={missing ?? value} rows={Math.min(24, Math.max(8, value.split("\n").length + 1))} className={cn(shared, "resize-y")} />
      ) : (
        <input id={id} readOnly value={missing ?? value} className={shared} />
      )}
    </div>
  );
}

export type EmailPanelProps = {
  /** `null` when the recipients cannot be resolved; `recipientsError` then says why. */
  to: string[] | null;
  cc: string[];
  recipientsError: string | null;
  subject: string;
  body: string;
  linkConfigured: boolean;
  /** Extra guidance, for example how to reply in the original thread after a handover. */
  hint?: string;
};

/**
 * The email text for copy and paste (brief §6.4, decision 2026-10-17). The application never sends
 * or opens mail: the user pastes each field into Outlook and sends it from there.
 */
export function EmailPanel({ to, cc, recipientsError, subject, body, linkConfigured, hint }: EmailPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Copy each field into a new Outlook message. This application does not send email or open Outlook for you.
      </p>
      {hint ? <p className="rounded-md border border-accent-foreground/20 bg-accent px-3 py-2 text-sm text-accent-foreground">{hint}</p> : null}
      {recipientsError ? (
        <p role="alert" className="rounded-md border border-warning bg-warning/15 px-3 py-2 text-sm">
          Recipients are not available: {recipientsError} Ask an administrator to fix the server configuration; the subject and text below can
          still be used.
        </p>
      ) : null}
      {!linkConfigured ? (
        <p role="status" className="rounded-md border border-warning bg-warning/15 px-3 py-2 text-sm">
          APP_BASE_URL is not configured, so the text has no link to this request.
        </p>
      ) : null}
      <CopyField id="email-to" label="To" value={(to ?? []).join("; ")} missing={to ? undefined : "(not configured)"} />
      <CopyField id="email-cc" label="Cc" value={cc.join("; ")} />
      <CopyField id="email-subject" label="Subject" value={subject} />
      <CopyField id="email-body" label="Text" value={body} multiline />
    </div>
  );
}
