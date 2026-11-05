"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, null);
  const [visible, setVisible] = useState(false);

  return (
    <form action={formAction} onSubmit={() => setVisible(false)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required maxLength={254} defaultValue={defaultEmail} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input id="password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" required maxLength={128} autoFocus={defaultEmail !== ""} className="pr-11" />
          {/* The label avoids the word "password" so a label lookup for the field still finds only the field. */}
          <button
            type="button"
            aria-controls="password"
            aria-pressed={visible}
            aria-label={visible ? "Sembunyikan sandi" : "Tampilkan sandi"}
            onClick={() => setVisible((value) => !value)}
            className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        </div>
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
