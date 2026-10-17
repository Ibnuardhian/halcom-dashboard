"use client";

import { useRef } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPORT_COLUMNS } from "@/domain/projects/export";

const GROUPS = [...new Set(EXPORT_COLUMNS.map((column) => column.group))];

/**
 * Pick the columns first, then download. The form is a plain GET to the export route, so the download works without
 * any script; the two buttons only tick or clear the boxes.
 */
export function ExportCard() {
  const form = useRef<HTMLFormElement>(null);
  const setAll = (checked: boolean) => form.current?.querySelectorAll<HTMLInputElement>('input[name="c"]').forEach((box) => (box.checked = checked));

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-base">
          <h2>Export projects</h2>
        </CardTitle>
        <CardDescription>Tick the columns you want, then download a CSV file that opens in Excel. Every project is included.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={form} action="/export/projects" method="get" className="flex flex-col gap-4">
          {GROUPS.map((group) => (
            <fieldset key={group} className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group}</legend>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {EXPORT_COLUMNS.filter((column) => column.group === group).map((column) => (
                  <label key={column.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="c" value={column.key} defaultChecked={column.preset} className="size-4 accent-primary" />
                    {column.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit">
              <Download aria-hidden data-icon="inline-start" />
              Export CSV
            </Button>
            <Button type="button" variant="outline" onClick={() => setAll(true)}>
              Select all
            </Button>
            <Button type="button" variant="outline" onClick={() => setAll(false)}>
              Clear
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
