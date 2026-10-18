"use client";

import { useActionState, useRef } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { cellKey } from "@/domain/access/permission-catalog";
import type { Role } from "@/domain/access/roles";
import { savePermissionsAction } from "./actions";

export type MatrixCategory = {
  id: string;
  title: string;
  description: string;
  permissions: { permission: string; label: string; description: string }[];
};

export type MatrixProps = {
  categories: MatrixCategory[];
  roles: { role: Role; label: string }[];
  /** Cell keys (see `cellKey`) the role holds right now. */
  granted: string[];
  /** Cell keys that differ from the built-in defaults. */
  changed: string[];
  /** Cell keys that cannot be changed (the guards forbid it). */
  locked: string[];
  /** Whether the viewer holds `permissions.manage`. Without it the matrix is read-only. */
  editable: boolean;
};

/**
 * The role permission matrix, grouped in collapsible categories. Anyone who may open the page sees what each role holds; a user with
 * `permissions.manage` also gets checkboxes and a Save button. The form posts the cells it shows and the ticked ones; the server
 * decides what is allowed, so hiding or disabling a box here is a courtesy and not the protection.
 */
export function PermissionMatrix({ categories, roles, granted, changed, locked, editable }: MatrixProps) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(savePermissionsAction, null);
  const container = useRef<HTMLFormElement>(null);
  const grantedSet = new Set(granted);
  const changedSet = new Set(changed);
  const lockedSet = new Set(locked);
  const rendered = categories.flatMap((category) => category.permissions.flatMap(({ permission }) => roles.map(({ role }) => cellKey(role, permission)))).filter((cell) => !lockedSet.has(cell));

  const setAll = (open: boolean) => container.current?.querySelectorAll("details").forEach((details) => (details.open = open));

  return (
    <form ref={container} action={formAction} className="flex flex-col gap-3">
      {editable ? <input type="hidden" name="rendered" value={rendered.join(" ")} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setAll(true)}>
          Expand all
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setAll(false)}>
          Collapse all
        </Button>
        <span className="text-xs text-muted-foreground">A dot (•) marks a permission changed from its default. A padlock marks one that cannot be changed.</span>
      </div>

      {categories.map((category, index) => (
        <details key={category.id} open={index === 0} className="rounded-lg border bg-card text-card-foreground" data-category={category.id}>
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
            <span className="text-sm font-medium">
              {index + 1}. {category.title}
            </span>
            <span className="text-xs text-muted-foreground">
              {category.permissions.length} permission{category.permissions.length === 1 ? "" : "s"} · {category.description}
            </span>
          </summary>
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <caption className="sr-only">{category.title}: permissions per role</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Permission
                  </th>
                  {roles.map(({ role, label }) => (
                    <th key={role} scope="col" className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {category.permissions.map(({ permission, label, description }) => (
                  <tr key={permission} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{description}</span>
                      <code className="text-xs text-muted-foreground">{permission}</code>
                    </th>
                    {roles.map(({ role, label: roleLabel }) => {
                      const cell = cellKey(role, permission);
                      const has = grantedSet.has(cell);
                      const isLocked = lockedSet.has(cell);
                      return (
                        <td key={role} className="px-2 py-2 text-center">
                          {editable ? (
                            <label className="inline-flex items-center gap-1">
                              <input
                                type="checkbox"
                                name="grant"
                                value={cell}
                                defaultChecked={has}
                                disabled={isLocked}
                                aria-label={`${label} for ${roleLabel}`}
                                className="size-4 accent-primary"
                              />
                              <Marks changed={changedSet.has(cell)} locked={isLocked} />
                            </label>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              {has ? (
                                <>
                                  <span aria-hidden>✓</span>
                                  <span className="sr-only">{`${label} for ${roleLabel}: allowed`}</span>
                                </>
                              ) : (
                                <>
                                  <span aria-hidden className="text-muted-foreground/50">
                                    –
                                  </span>
                                  <span className="sr-only">{`${label} for ${roleLabel}: not allowed`}</span>
                                </>
                              )}
                              <Marks changed={changedSet.has(cell)} locked={isLocked} />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      {editable ? (
        <div className="flex flex-col gap-2">
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save permissions"}
            </Button>
          </div>
          <FormStatus state={state} />
        </div>
      ) : null}
    </form>
  );
}

function Marks({ changed, locked }: { changed: boolean; locked: boolean }) {
  return (
    <>
      {changed ? (
        <span title="Changed from the default" className="text-xs text-primary">
          <span aria-hidden>•</span>
          <span className="sr-only">changed from the default</span>
        </span>
      ) : null}
      {locked ? (
        <span title="This cannot be changed" className="text-muted-foreground">
          <Lock aria-hidden className="size-3" />
          <span className="sr-only">cannot be changed</span>
        </span>
      ) : null}
    </>
  );
}
