"use client";

import { useRef, useState, useTransition } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IMPORT_FIELDS, type ColumnMapping, type ImportFieldKey } from "@/domain/projects/import";
import { cn } from "@/lib/utils";
import type { CommitMode, CommitResult, ImportSummary, PreviewResult } from "@/server/import/xlsx-projects";
import type { UpdateCommitResult, UpdatePreviewResult, UpdateSummary } from "@/server/import/xlsx-projects-update";
import { commitImportAction, commitUpdateAction, inspectSheetAction, previewImportAction, previewUpdateAction, type InspectResult } from "./import-actions";

type Inspected = Extract<InspectResult, { ok: true }>;

const STATUS_TEXT = { ready: "Will be imported", duplicate: "Duplicate (skipped)", error: "Problem" } as const;

/** "A: Customer": the column letter, so the person can find it in Excel, and its header. */
function columnLabel(index: number, header: string): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}: ${header || "(no header)"}`;
}

/**
 * Importing projects from an Excel sheet in three steps: choose the file, match its columns to the fields, check the rows and import.
 * The file is sent again with every step and checked again on the server; this component only holds what the person chose.
 */
export function ImportWizard({ onClose, canUpdate = false }: { onClose?: () => void; canUpdate?: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [mode, setMode] = useState<CommitMode>("atomic");
  // "update" changes existing projects found by Project ID; only offered to those who may bulk update.
  const [intent, setIntent] = useState<"create" | "update">("create");
  const [updateSummary, setUpdateSummary] = useState<UpdateSummary | null>(null);
  const [updateResult, setUpdateResult] = useState<Extract<UpdateCommitResult, { ok: true }> | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [result, setResult] = useState<Extract<CommitResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const body = (extra: Record<string, string> = {}) => {
    const form = new FormData();
    if (file) form.set("file", file);
    if (mapping) form.set("mapping", JSON.stringify(mapping));
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    return form;
  };

  function reset() {
    setFile(null);
    setInspected(null);
    setMapping(null);
    setSummary(null);
    setResult(null);
    setError(null);
    setMode("atomic");
    setUpdateSummary(null);
    setUpdateResult(null);
    setConfirmNew(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function inspect(chosen: File) {
    setFile(chosen);
    setInspected(null);
    setSummary(null);
    setUpdateSummary(null);
    setUpdateResult(null);
    setConfirmNew(false);
    setResult(null);
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("file", chosen);
      const answer = await inspectSheetAction(form);
      if (answer.ok) {
        setInspected(answer);
        setMapping(answer.suggested);
      } else setError(answer.message);
    });
  }

  function check() {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const answer: PreviewResult = await previewImportAction(body());
      if (answer.ok) setSummary(answer.summary);
      else setError(answer.message);
    });
  }

  function runImport() {
    setError(null);
    startTransition(async () => {
      const answer = await commitImportAction(body({ mode }));
      if (answer.ok) {
        setResult(answer);
        setSummary(answer.summary);
      } else {
        setError(answer.message);
        if (answer.summary) setSummary(answer.summary);
      }
    });
  }

  function checkUpdate() {
    setError(null);
    setUpdateSummary(null);
    setConfirmNew(false);
    startTransition(async () => {
      const answer: UpdatePreviewResult = await previewUpdateAction(body());
      if (answer.ok) setUpdateSummary(answer.summary);
      else setError(answer.message);
    });
  }

  function runUpdate() {
    setError(null);
    startTransition(async () => {
      const answer = await commitUpdateAction(body({ confirmNew: String(confirmNew) }));
      if (answer.ok) {
        setUpdateResult(answer);
        setUpdateSummary(answer.summary);
      } else {
        setError(answer.message);
        if (answer.summary) setUpdateSummary(answer.summary);
      }
    });
  }

  const changeMapping = (key: ImportFieldKey, value: string) => {
    setSummary(null);
    setUpdateSummary(null);
    setMapping((current) => (current ? { ...current, [key]: value === "" ? null : Number(value) } : current));
  };

  // Updating finds each project by its Project ID, so that column is required too.
  const missingRequired = mapping ? IMPORT_FIELDS.filter((field) => (field.required || (intent === "update" && field.key === "code")) && mapping[field.key] === null) : [];
  const usedTwice = mapping ? Object.values(mapping).filter((value): value is number => value !== null).some((value, _, all) => all.indexOf(value) !== all.lastIndexOf(value)) : false;

  if (updateResult) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Update finished</h2>
          </CardTitle>
          <CardDescription>
            {file?.name}: {updateResult.updated} project{updateResult.updated === 1 ? "" : "s"} updated, {updateResult.unchanged} unchanged, {updateResult.skipped} skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            Updated: {updateResult.codes.slice(0, 20).join(", ")}
            {updateResult.codes.length > 20 ? ` and ${updateResult.codes.length - 20} more` : ""}. Every change is in the project&apos;s Change log.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Close and show the projects
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Update another file
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Import finished</h2>
          </CardTitle>
          <CardDescription>
            {file?.name}: {result.created} project{result.created === 1 ? "" : "s"} created, {result.skippedDuplicates} duplicate{result.skippedDuplicates === 1 ? "" : "s"} skipped, {result.skippedInvalid} row
            {result.skippedInvalid === 1 ? "" : "s"} with problems skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            Created: {result.codes.slice(0, 20).join(", ")}
            {result.codes.length > 20 ? ` and ${result.codes.length - 20} more` : ""}.
          </p>
          <SummaryTable summary={result.summary} />
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Close and show the projects
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Import another file
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>1. Download the template and attach your file</h2>
          </CardTitle>
          <CardDescription>
            Fill the template (one project per row, the first row holds the column names), then drop the file below. An .xlsx workbook, up to 5 MB and 5,000 rows; the first sheet is read.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canUpdate ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">What do you want to do?</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="import-intent" checked={intent === "create"} onChange={() => setIntent("create")} className="mt-1" />
                <span>Import new projects (a Project ID that exists is skipped)</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="import-intent" checked={intent === "update"} onChange={() => setIntent("update")} className="mt-1" />
                <span>Update existing projects: edit an export of the projects, then upload it. Rows are matched by Project ID; an empty cell changes nothing.</span>
              </label>
            </fieldset>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <a href="/export/projects-template" download className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden data-icon="inline-start" />
              Download template
            </a>
            <a href="/export/projects?format=import" download className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden data-icon="inline-start" />
              Export projects in this format
            </a>
            <span className="text-xs text-muted-foreground">Columns marked * must be filled; the others are optional.</span>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">What each column holds</summary>
            <div className="mt-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>What to write</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {IMPORT_FIELDS.map((field) => (
                    <TableRow key={field.key}>
                      <TableCell className="font-medium whitespace-nowrap">{field.label}</TableCell>
                      <TableCell>{field.required ? "Yes" : "No"}</TableCell>
                      <TableCell className="text-muted-foreground">{field.hint ?? "Plain text."}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
          <label
            htmlFor="import-file"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const dropped = event.dataTransfer.files[0];
              if (dropped && !pending) inspect(dropped);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-accent/40",
              dragging && "border-primary bg-accent/60",
            )}
          >
            <FileSpreadsheet aria-hidden className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium">{file ? file.name : "Drag the .xlsx file here, or click to choose it"}</span>
            <span className="text-xs text-muted-foreground">{pending && !inspected ? "Reading the file…" : "Excel workbook (.xlsx)"}</span>
            <input
              id="import-file"
              ref={fileInput}
              type="file"
              aria-label="Excel workbook (.xlsx)"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending}
              className="sr-only"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) inspect(chosen);
              }}
            />
          </label>
          {inspected ? (
            <p role="status" className="text-sm text-muted-foreground">
              {inspected.fileName}: sheet “{inspected.sheetName}”, {inspected.rowCount} row{inspected.rowCount === 1 ? "" : "s"} of data, {inspected.headers.length} column{inspected.headers.length === 1 ? "" : "s"}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {inspected && mapping ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>2. Match the columns</h2>
            </CardTitle>
            <CardDescription>Each field takes one column of your sheet. The matches below are suggestions from the column names; change any of them. Fields marked * are required.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((field) => (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`map-${field.key}`}>
                    {field.label}
                    {field.required ? " *" : ""}
                  </Label>
                  <NativeSelect id={`map-${field.key}`} value={mapping[field.key] === null ? "" : String(mapping[field.key])} onChange={(event) => changeMapping(field.key, event.target.value)}>
                    <option value="">{field.required ? "Choose a column" : "Not in my sheet"}</option>
                    {inspected.headers.map((header, index) => (
                      <option key={index} value={index}>
                        {columnLabel(index, header)}
                      </option>
                    ))}
                  </NativeSelect>
                  {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
                </div>
              ))}
            </div>
            {usedTwice ? (
              <p role="alert" className="text-sm text-destructive">
                One column is chosen for two fields. Each column can be used once.
              </p>
            ) : null}
            <details>
              <summary className="cursor-pointer text-sm font-medium">The first rows of your sheet</summary>
              <div className="mt-2 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {inspected.headers.map((header, index) => (
                        <TableHead key={index}>{columnLabel(index, header)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inspected.sample.map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {inspected.headers.map((_, index) => (
                          <TableCell key={index} className="max-w-48 truncate">
                            {row[index] ?? ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={pending || missingRequired.length > 0 || usedTwice} onClick={intent === "update" ? checkUpdate : check}>
                {pending ? "Checking…" : "Check the sheet"}
              </Button>
              {missingRequired.length > 0 ? <span className="text-sm text-muted-foreground">Choose a column for {missingRequired.map((field) => field.label).join(" and ")}.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {intent === "create" && summary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>3. Check and import</h2>
            </CardTitle>
            <CardDescription>
              {summary.totalRows} row{summary.totalRows === 1 ? "" : "s"} in “{summary.sheetName}”: <strong>{summary.ready}</strong> ready, <strong>{summary.duplicates}</strong> duplicate{summary.duplicates === 1 ? "" : "s"} (skipped, never
              updated), <strong>{summary.errors}</strong> with problems. Nothing is written until you import.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {summary.newPrincipals.length > 0 || summary.newSolutions.length > 0 ? (
              <p className="text-sm">
                The import will add{summary.newPrincipals.length > 0 ? <> principals: {summary.newPrincipals.join(", ")}</> : null}
                {summary.newPrincipals.length > 0 && summary.newSolutions.length > 0 ? "; " : null}
                {summary.newSolutions.length > 0 ? <> solutions: {summary.newSolutions.join(", ")}</> : null}.
              </p>
            ) : null}
            <SummaryTable summary={summary} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">If some rows have problems</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="import-mode" checked={mode === "atomic"} onChange={() => setMode("atomic")} className="mt-1" />
                <span>Import nothing until every row is fixed (all or nothing)</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="import-mode" checked={mode === "skip-invalid"} onChange={() => setMode("skip-invalid")} className="mt-1" />
                <span>Import the valid rows and skip the rows with problems</span>
              </label>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={pending || summary.ready === 0 || (mode === "atomic" && summary.errors > 0)} onClick={runImport}>
                {pending ? "Importing…" : `Import ${summary.ready} project${summary.ready === 1 ? "" : "s"}`}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={check}>
                Check again
              </Button>
              {mode === "atomic" && summary.errors > 0 ? <span className="text-sm text-muted-foreground">Fix the rows with problems in Excel and choose the file again, or choose to skip them.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {intent === "update" && updateSummary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>3. Check and update</h2>
            </CardTitle>
            <CardDescription>
              {updateSummary.totalRows} row{updateSummary.totalRows === 1 ? "" : "s"} in “{updateSummary.sheetName}”: <strong>{updateSummary.toUpdate}</strong> to update, <strong>{updateSummary.unchanged}</strong> unchanged,{" "}
              <strong>{updateSummary.skipped}</strong> skipped (no matching Project ID), <strong>{updateSummary.errors}</strong> with problems. Nothing is written until you update.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {updateSummary.newCustomers.length + updateSummary.newPrincipals.length + updateSummary.newSolutions.length > 0 ? (
              <div role="alert" className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm">
                <p>
                  These names do not exist yet and will be <strong>created</strong>. Check the spelling: a typo makes a new customer or principal.
                </p>
                <ul className="list-disc pl-5">
                  {updateSummary.newCustomers.length > 0 ? <li>Customers: {updateSummary.newCustomers.join(", ")}</li> : null}
                  {updateSummary.newPrincipals.length > 0 ? <li>Principals: {updateSummary.newPrincipals.join(", ")}</li> : null}
                  {updateSummary.newSolutions.length > 0 ? <li>Solutions: {updateSummary.newSolutions.join(", ")}</li> : null}
                </ul>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={confirmNew} onChange={(event) => setConfirmNew(event.target.checked)} />
                  The spelling is right, create them
                </label>
              </div>
            ) : null}
            <UpdateTable summary={updateSummary} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={pending || updateSummary.toUpdate === 0 || updateSummary.errors > 0 || (updateSummary.newCustomers.length + updateSummary.newPrincipals.length + updateSummary.newSolutions.length > 0 && !confirmNew)} onClick={runUpdate}>
                {pending ? "Updating…" : `Update ${updateSummary.toUpdate} project${updateSummary.toUpdate === 1 ? "" : "s"}`}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={checkUpdate}>
                Check again
              </Button>
              {updateSummary.errors > 0 ? <span className="text-sm text-muted-foreground">All or nothing: fix the rows with problems in Excel and choose the file again.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SummaryTable({ summary }: { summary: ImportSummary }) {
  if (summary.rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sheet row</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>End user</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.rows.map((row) => (
            <TableRow key={`${row.status}-${row.sheetRow}`}>
              <TableCell className="tabular-nums">{row.sheetRow}</TableCell>
              <TableCell className={row.status === "error" ? "text-destructive" : row.status === "duplicate" ? "text-amber-700 dark:text-amber-400" : undefined}>{STATUS_TEXT[row.status]}</TableCell>
              <TableCell className="max-w-48 truncate">{row.endUser || "–"}</TableCell>
              <TableCell className="max-w-64 truncate">{row.name || "–"}</TableCell>
              <TableCell>
                {row.messages.length === 0 ? (
                  "–"
                ) : (
                  <ul className="list-disc pl-4">
                    {row.messages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {summary.detailTruncated ? <p className="mt-2 text-xs text-muted-foreground">Only the first rows with problems are listed; the counts above cover every row.</p> : null}
    </div>
  );
}

const UPDATE_STATUS_TEXT = { update: "Will be updated", unchanged: "No change", skipped: "Skipped", error: "Problem" } as const;

function UpdateTable({ summary }: { summary: UpdateSummary }) {
  if (summary.rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sheet row</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>What changes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.rows.map((row) => (
            <TableRow key={`${row.status}-${row.sheetRow}`}>
              <TableCell className="tabular-nums">{row.sheetRow}</TableCell>
              <TableCell className={row.status === "error" ? "text-destructive" : row.status === "skipped" ? "text-amber-700 dark:text-amber-400" : undefined}>{UPDATE_STATUS_TEXT[row.status]}</TableCell>
              <TableCell className="max-w-64">
                <span className="font-mono text-xs">{row.code || "–"}</span>
                <span className="block truncate">{row.name || "–"}</span>
              </TableCell>
              <TableCell>
                {row.messages.length === 0 && row.changes.length === 0 ? (
                  "–"
                ) : (
                  <ul className="list-disc pl-4">
                    {row.messages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                    {row.changes.map((change) => (
                      <li key={change.label}>
                        {change.label}: {change.from ?? "–"} → {change.to ?? "–"}
                      </li>
                    ))}
                  </ul>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {summary.detailTruncated ? <p className="mt-2 text-xs text-muted-foreground">Only the first rows are listed; the counts above cover every row.</p> : null}
    </div>
  );
}
