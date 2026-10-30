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

const STATUS_TEXT = { ready: "Akan diimpor", duplicate: "Duplikat (dilewati)", error: "Bermasalah" } as const;

/** "A: Customer": the column letter, so the person can find it in Excel, and its header. */
function columnLabel(index: number, header: string): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}: ${header || "(tanpa judul kolom)"}`;
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
            <h2>Pembaruan selesai</h2>
          </CardTitle>
          <CardDescription>
            {file?.name}: {updateResult.updated} project diperbarui, {updateResult.unchanged} tidak berubah, {updateResult.skipped} dilewati.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            Updated: {updateResult.codes.slice(0, 20).join(", ")}
            {updateResult.codes.length > 20 ? ` dan ${updateResult.codes.length - 20} lainnya` : ""}. Setiap perubahan tercatat di Change log project.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Tutup dan tampilkan project
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Perbarui dengan berkas lain
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
            <h2>Impor selesai</h2>
          </CardTitle>
          <CardDescription>
            {file?.name}: {result.created} project dibuat, {result.skippedDuplicates} duplikat dilewati, {result.skippedInvalid} baris bermasalah dilewati.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            Created: {result.codes.slice(0, 20).join(", ")}
            {result.codes.length > 20 ? ` dan ${result.codes.length - 20} lainnya` : ""}.
          </p>
          <SummaryTable summary={result.summary} />
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Tutup dan tampilkan project
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Impor berkas lain
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
            <h2>1. Unduh template dan lampirkan berkas Anda</h2>
          </CardTitle>
          <CardDescription>
            Isi template (satu project per baris, baris pertama berisi nama kolom), lalu letakkan berkas di bawah. Berkas .xlsx, maksimal 5 MB dan 5.000 baris; sheet pertama yang dibaca.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canUpdate ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Apa yang ingin Anda lakukan?</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="import-intent" checked={intent === "create"} onChange={() => setIntent("create")} className="mt-1" />
                <span>Impor project baru (Project ID yang sudah ada dilewati)</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="import-intent" checked={intent === "update"} onChange={() => setIntent("update")} className="mt-1" />
                <span>Perbarui project yang sudah ada: edit hasil export project, lalu unggah. Baris dicocokkan lewat Project ID; sel kosong tidak mengubah apa pun.</span>
              </label>
            </fieldset>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <a href="/export/projects-template" download className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden data-icon="inline-start" />
              Unduh template
            </a>
            <a href="/export/projects?format=import" download className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden data-icon="inline-start" />
              Export project dalam format ini
            </a>
            <span className="text-xs text-muted-foreground">Kolom bertanda * wajib diisi; yang lain boleh kosong.</span>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Isi setiap kolom</summary>
            <div className="mt-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kolom</TableHead>
                    <TableHead>Wajib</TableHead>
                    <TableHead>Yang ditulis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {IMPORT_FIELDS.map((field) => (
                    <TableRow key={field.key}>
                      <TableCell className="font-medium whitespace-nowrap">{field.label}</TableCell>
                      <TableCell>{field.required ? "Ya" : "Tidak"}</TableCell>
                      <TableCell className="text-muted-foreground">{field.hint ?? "Teks biasa."}</TableCell>
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
            <span className="text-sm font-medium">{file ? file.name : "Seret berkas .xlsx ke sini, atau klik untuk memilihnya"}</span>
            <span className="text-xs text-muted-foreground">{pending && !inspected ? "Membaca berkas…" : "Workbook Excel (.xlsx)"}</span>
            <input
              id="import-file"
              ref={fileInput}
              type="file"
              aria-label="Workbook Excel (.xlsx)"
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
              {inspected.fileName}: sheet “{inspected.sheetName}”, {inspected.rowCount} baris data, {inspected.headers.length} kolom.
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
              <h2>2. Cocokkan kolom</h2>
            </CardTitle>
            <CardDescription>Setiap field memakai satu kolom dari sheet Anda. Pencocokan di bawah adalah saran dari nama kolom; ubah bila perlu. Field bertanda * wajib.</CardDescription>
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
                    <option value="">{field.required ? "Pilih kolom" : "Tidak ada di sheet saya"}</option>
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
                Satu kolom dipilih untuk dua field. Setiap kolom hanya boleh dipakai sekali.
              </p>
            ) : null}
            <details>
              <summary className="cursor-pointer text-sm font-medium">Beberapa baris pertama sheet Anda</summary>
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
                {pending ? "Memeriksa…" : "Periksa sheet"}
              </Button>
              {missingRequired.length > 0 ? <span className="text-sm text-muted-foreground">Pilih kolom untuk {missingRequired.map((field) => field.label).join(" and ")}.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {intent === "create" && summary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>3. Periksa dan impor</h2>
            </CardTitle>
            <CardDescription>
              {summary.totalRows} baris di “{summary.sheetName}”: <strong>{summary.ready}</strong> siap, <strong>{summary.duplicates}</strong> duplikat (dilewati, tidak pernah diperbarui), <strong>{summary.errors}</strong> bermasalah. Tidak ada yang ditulis sebelum Anda mengimpor.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {summary.newPrincipals.length > 0 || summary.newSolutions.length > 0 ? (
              <p className="text-sm">
                Impor akan menambah{summary.newPrincipals.length > 0 ? <> principal: {summary.newPrincipals.join(", ")}</> : null}
                {summary.newPrincipals.length > 0 && summary.newSolutions.length > 0 ? "; " : null}
                {summary.newSolutions.length > 0 ? <> solution: {summary.newSolutions.join(", ")}</> : null}.
              </p>
            ) : null}
            <SummaryTable summary={summary} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Jika ada baris yang bermasalah</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="import-mode" checked={mode === "atomic"} onChange={() => setMode("atomic")} className="mt-1" />
                <span>Jangan impor apa pun sampai semua baris diperbaiki (semua atau tidak sama sekali)</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="import-mode" checked={mode === "skip-invalid"} onChange={() => setMode("skip-invalid")} className="mt-1" />
                <span>Impor baris yang valid dan lewati baris yang bermasalah</span>
              </label>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={pending || summary.ready === 0 || (mode === "atomic" && summary.errors > 0)} onClick={runImport}>
                {pending ? "Mengimpor…" : `Impor ${summary.ready} project`}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={check}>
                Periksa ulang
              </Button>
              {mode === "atomic" && summary.errors > 0 ? <span className="text-sm text-muted-foreground">Perbaiki baris yang bermasalah di Excel lalu pilih berkas lagi, atau pilih untuk melewatinya.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {intent === "update" && updateSummary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>3. Periksa dan perbarui</h2>
            </CardTitle>
            <CardDescription>
              {updateSummary.totalRows} baris di “{updateSummary.sheetName}”: <strong>{updateSummary.toUpdate}</strong> akan diperbarui, <strong>{updateSummary.unchanged}</strong> tidak berubah,{" "}
              <strong>{updateSummary.skipped}</strong> dilewati (Project ID tidak cocok), <strong>{updateSummary.errors}</strong> bermasalah. Tidak ada yang ditulis sebelum Anda memperbarui.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {updateSummary.newCustomers.length + updateSummary.newPrincipals.length + updateSummary.newSolutions.length > 0 ? (
              <div role="alert" className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm">
                <p>
                  Nama berikut belum ada dan akan <strong>dibuat</strong>. Periksa ejaannya: salah ketik akan membuat customer atau principal baru.
                </p>
                <ul className="list-disc pl-5">
                  {updateSummary.newCustomers.length > 0 ? <li>Customer: {updateSummary.newCustomers.join(", ")}</li> : null}
                  {updateSummary.newPrincipals.length > 0 ? <li>Principals: {updateSummary.newPrincipals.join(", ")}</li> : null}
                  {updateSummary.newSolutions.length > 0 ? <li>Solutions: {updateSummary.newSolutions.join(", ")}</li> : null}
                </ul>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={confirmNew} onChange={(event) => setConfirmNew(event.target.checked)} />
                  Ejaannya benar, buat nama-nama ini
                </label>
              </div>
            ) : null}
            <UpdateTable summary={updateSummary} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={pending || updateSummary.toUpdate === 0 || updateSummary.errors > 0 || (updateSummary.newCustomers.length + updateSummary.newPrincipals.length + updateSummary.newSolutions.length > 0 && !confirmNew)} onClick={runUpdate}>
                {pending ? "Memperbarui…" : `Perbarui ${updateSummary.toUpdate} project`}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={checkUpdate}>
                Periksa ulang
              </Button>
              {updateSummary.errors > 0 ? <span className="text-sm text-muted-foreground">Semua atau tidak sama sekali: perbaiki baris yang bermasalah di Excel, lalu pilih berkas lagi.</span> : null}
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
            <TableHead>Baris sheet</TableHead>
            <TableHead>Hasil</TableHead>
            <TableHead>End user</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Rincian</TableHead>
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
      {summary.detailTruncated ? <p className="mt-2 text-xs text-muted-foreground">Hanya baris bermasalah yang pertama ditampilkan; jumlah di atas mencakup semua baris.</p> : null}
    </div>
  );
}

const UPDATE_STATUS_TEXT = { update: "Akan diperbarui", unchanged: "Tidak berubah", skipped: "Dilewati", error: "Bermasalah" } as const;

function UpdateTable({ summary }: { summary: UpdateSummary }) {
  if (summary.rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Baris sheet</TableHead>
            <TableHead>Hasil</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Yang berubah</TableHead>
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
      {summary.detailTruncated ? <p className="mt-2 text-xs text-muted-foreground">Hanya baris pertama yang ditampilkan; jumlah di atas mencakup semua baris.</p> : null}
    </div>
  );
}
