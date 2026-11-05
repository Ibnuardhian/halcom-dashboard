"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, Download, FileSpreadsheet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IMPORT_FIELDS, type ColumnMapping, type ImportFieldKey } from "@/domain/projects/import";
import { cn } from "@/lib/utils";
import type { SyncCommitResult, SyncMode, SyncRowReport, SyncRowStatus, SyncSummary } from "@/server/import/xlsx-projects-sync";
import { commitSyncAction, inspectSheetAction, previewSyncAction, type InspectResult } from "./import-actions";

type Inspected = Extract<InspectResult, { ok: true }>;

const STATUS_TEXT: Record<SyncRowStatus, string> = { new: "Project baru", update: "Diperbarui", unchanged: "Tidak berubah", skipped: "Dilewati", duplicate: "Duplikat (dilewati)", error: "Bermasalah" };
const STATUS_CLASS: Partial<Record<SyncRowStatus, string>> = {
  new: "text-emerald-700 dark:text-emerald-400",
  skipped: "text-amber-700 dark:text-amber-400",
  duplicate: "text-amber-700 dark:text-amber-400",
  error: "text-destructive",
};

/** "A: Customer": the column letter, so the person can find it in Excel, and its header. */
function columnLabel(index: number, header: string): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}: ${header || "(tanpa judul kolom)"}`;
}

const REQUIRED = IMPORT_FIELDS.filter((field) => field.required);
const usedColumns = (mapping: ColumnMapping) => new Set(Object.values(mapping).filter((value): value is number => value !== null));

/**
 * Uploading projects from an Excel sheet. One file adds and updates: a row with a Project ID that exists updates that project, a row without
 * one is a new project. The columns are found by their names, so only what could not be found is asked. The file is sent again with every
 * step and checked again on the server; this component only holds what the person chose.
 */
export function ImportWizard({ onClose, canCreate = true, canUpdate = false }: { onClose?: () => void; canCreate?: boolean; canUpdate?: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [mode, setMode] = useState<SyncMode>("atomic");
  const [confirmNew, setConfirmNew] = useState(false);
  const [result, setResult] = useState<Extract<SyncCommitResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const bodyOf = (chosen: File, columns: ColumnMapping, extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("file", chosen);
    form.set("mapping", JSON.stringify(columns));
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
    setConfirmNew(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function checkSheet(chosen: File, columns: ColumnMapping) {
    const answer = await previewSyncAction(bodyOf(chosen, columns));
    if (answer.ok) setSummary(answer.summary);
    else setError(answer.message);
  }

  function inspect(chosen: File) {
    setFile(chosen);
    setInspected(null);
    setMapping(null);
    setSummary(null);
    setConfirmNew(false);
    setResult(null);
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("file", chosen);
      const answer = await inspectSheetAction(form);
      if (!answer.ok) return setError(answer.message);
      setInspected(answer);
      setMapping(answer.suggested);
      // Nothing to ask when every required column was found by its name: the check runs at once.
      if (REQUIRED.every((field) => answer.suggested[field.key] !== null)) await checkSheet(chosen, answer.suggested);
    });
  }

  function check() {
    if (!file || !mapping) return;
    setError(null);
    setSummary(null);
    setConfirmNew(false);
    startTransition(() => checkSheet(file, mapping));
  }

  function save() {
    if (!file || !mapping) return;
    setError(null);
    startTransition(async () => {
      const answer = await commitSyncAction(bodyOf(file, mapping, { mode, confirmNew: String(confirmNew) }));
      if (answer.ok) {
        setResult(answer);
        setSummary(answer.summary);
      } else {
        setError(answer.message);
        if (answer.summary) setSummary(answer.summary);
      }
    });
  }

  /** Gives a column to a field (or takes it back with `null`); a column or a field is used once, so whatever it replaces is cleared. */
  const assign = (field: ImportFieldKey | null, column: number | null, from?: { column?: number }) => {
    setSummary(null);
    setConfirmNew(false);
    setMapping((current) => {
      if (!current) return current;
      const next = { ...current };
      if (from?.column !== undefined) for (const key of Object.keys(next) as ImportFieldKey[]) if (next[key] === from.column) next[key] = null;
      if (field) {
        for (const key of Object.keys(next) as ImportFieldKey[]) if (column !== null && next[key] === column && key !== field) next[key] = null;
        next[field] = column;
      }
      return next;
    });
  };

  const missingRequired = mapping ? REQUIRED.filter((field) => mapping[field.key] === null) : [];
  // Columns the names did not match, as found when the file was read: they stay listed while the person gives them a field.
  const unrecognised = inspected ? inspected.headers.map((header, index) => ({ header, index })).filter(({ header, index }) => header.trim() !== "" && !usedColumns(inspected.suggested).has(index)) : [];
  const recognised = inspected ? IMPORT_FIELDS.filter((field) => inspected.suggested[field.key] !== null) : [];
  const needsNames = summary ? summary.newCustomers.length + summary.newSolutions.length > 0 : false;
  const attention = missingRequired.length > 0 || unrecognised.length > 0 || (mapping !== null && mapping.code === null);

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Selesai</h2>
          </CardTitle>
          <CardDescription>
            {file?.name}: <strong>{result.created.length}</strong> project baru, <strong>{result.updated.length}</strong> diperbarui, {result.unchanged} tidak berubah, {result.skipped + result.duplicates} dilewati
            {result.skippedInvalid > 0 ? `, ${result.skippedInvalid} bermasalah tidak disimpan` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            Setiap perubahan tercatat di Change log project, dan pemilik Sales diberi tahu.
          </p>
          <ResultTable result={result} />
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Tutup dan tampilkan project
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Unggah berkas lain
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
        <Step number={1} title="Export atau unduh template">
          <p className="text-sm text-muted-foreground">Pakai berkas dari sini agar kolomnya sesuai: data project saat ini untuk diedit, atau template kosong untuk project baru.</p>
          <TemplateMenu canCreate={canCreate} canUpdate={canUpdate} />
        </Step>
        <Step number={2} title="Lengkapi data">
          <p className="text-sm text-muted-foreground">
            Baris dengan Project ID yang sudah ada <strong>memperbarui</strong> project itu (sel kosong dibiarkan apa adanya). Baris tanpa Project ID menjadi <strong>project baru</strong>. Jangan ubah baris
            pertama (nama kolom): kolom dicari lewat namanya, jadi urutannya boleh berbeda.
          </p>
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center rounded-lg border px-3 py-1.5 text-sm font-medium select-none marker:content-none hover:bg-accent/40">
              <span className="group-open:hidden">Tampilkan ketentuan pengisian</span>
              <span className="hidden group-open:inline">Sembunyikan ketentuan pengisian</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <ul className="list-disc pl-5 text-sm">
                <li>Berkas .xlsx, maksimal 5 MB dan 5.000 baris. Hanya sheet pertama yang dibaca.</li>
                <li>Tanggal ditulis YYYY-MM-DD atau DD/MM/YYYY.</li>
                <li>Beberapa nilai dalam satu sel (misalnya principal) dipisahkan dengan ; atau baris baru.</li>
                <li>Progress dan Status dipilih dari daftar di Excel.</li>
              </ul>
              <div className="overflow-x-auto">
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
            </div>
          </details>
        </Step>
        <Step number={3} title="Unggah berkas">
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
            <span className="text-xs text-muted-foreground">{pending && !summary ? "Membaca dan memeriksa berkas…" : "Workbook Excel (.xlsx)"}</span>
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
        </Step>
      </ol>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {inspected && mapping ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Kolom</h2>
            </CardTitle>
            <CardDescription>
              {recognised.length} dari {inspected.headers.filter((header) => header.trim() !== "").length} kolom dikenali dari namanya.
              {attention ? " Yang di bawah ini perlu perhatian Anda." : " Tidak ada yang perlu dicocokkan."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {missingRequired.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {missingRequired.map((field) => (
                  <ColumnSelect key={field.key} id={`map-${field.key}`} label={`${field.label} *`} hint="Wajib, tetapi belum ditemukan dari nama kolom." value={mapping[field.key]} headers={inspected.headers} used={usedColumns(mapping)} onChange={(column) => assign(field.key, column)} />
                ))}
              </div>
            ) : null}
            {mapping.code === null ? (
              <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm">
                <p>
                  Tidak ada kolom <strong>Project ID</strong>, jadi semua baris akan dianggap <strong>project baru</strong>. Pilih kolomnya bila ada di sheet Anda.
                </p>
                <div className="sm:max-w-xs">
                  <ColumnSelect id="map-code" label="Project ID" value={mapping.code} headers={inspected.headers} used={usedColumns(mapping)} onChange={(column) => assign("code", column)} />
                </div>
              </div>
            ) : null}
            {unrecognised.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Kolom yang tidak dikenali (diabaikan kecuali Anda memilih fieldnya)</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {unrecognised.map(({ header, index }) => {
                    const current = IMPORT_FIELDS.find((field) => mapping[field.key] === index)?.key ?? "";
                    return (
                      <div key={index} className="flex flex-col gap-1.5">
                        <Label htmlFor={`col-${index}`}>{columnLabel(index, header)}</Label>
                        <NativeSelect id={`col-${index}`} value={current} onChange={(event) => assign((event.target.value || null) as ImportFieldKey | null, index, { column: index })}>
                          <option value="">Abaikan kolom ini</option>
                          {IMPORT_FIELDS.filter((field) => mapping[field.key] === null || field.key === current).map((field) => (
                            <option key={field.key} value={field.key}>
                              {field.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <details>
              <summary className="cursor-pointer text-sm font-medium">Lihat dan ubah semua pemetaan kolom</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {IMPORT_FIELDS.map((field) => (
                  <ColumnSelect key={field.key} id={`all-${field.key}`} label={`${field.label}${field.required ? " *" : ""}`} value={mapping[field.key]} headers={inspected.headers} used={usedColumns(mapping)} none={field.required ? "Pilih kolom" : "Tidak ada di sheet saya"} onChange={(column) => assign(field.key, column)} />
                ))}
              </div>
            </details>
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
            {attention || !summary ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" disabled={pending || missingRequired.length > 0} onClick={check}>
                  {pending ? "Memeriksa…" : summary ? "Periksa ulang" : "Periksa sheet"}
                </Button>
                {missingRequired.length > 0 ? <span className="text-sm text-muted-foreground">Pilih kolom untuk {missingRequired.map((field) => field.label).join(", ")}.</span> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {summary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Periksa dan simpan</h2>
            </CardTitle>
            <CardDescription>
              {summary.totalRows} baris di “{summary.sheetName}”: <strong>{summary.created}</strong> project baru, <strong>{summary.updated}</strong> diperbarui, {summary.unchanged} tidak berubah,{" "}
              {summary.skipped + summary.duplicates} dilewati, <strong>{summary.errors}</strong> bermasalah. Data ditulis setelah Anda menyimpan.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {needsNames ? (
              <div role="alert" className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm">
                <p>
                  Nama berikut belum ada dan akan <strong>dibuat</strong>. Periksa ejaannya: salah ketik akan membuat customer atau solution baru.
                </p>
                <ul className="list-disc pl-5">
                  {summary.newCustomers.length > 0 ? <li>Customer: {summary.newCustomers.join(", ")}</li> : null}
                  {summary.newSolutions.length > 0 ? <li>Solutions: {summary.newSolutions.join(", ")}</li> : null}
                </ul>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={confirmNew} onChange={(event) => setConfirmNew(event.target.checked)} />
                  Ejaannya benar, buat nama-nama ini
                </label>
              </div>
            ) : null}
            {summary.newPrincipals.length > 0 ? (
              <p role="status" className="rounded-md border px-3 py-2 text-sm">
                Principal berikut belum ada dan akan <strong>dibuat otomatis</strong> saat disimpan: {summary.newPrincipals.join(", ")}. Periksa ejaannya; nama yang salah ketik bisa dirapikan nanti di Master data.
              </p>
            ) : null}
            <SyncTable summary={summary} />
            {summary.errors > 0 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Jika ada baris yang bermasalah</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="import-mode" checked={mode === "atomic"} onChange={() => setMode("atomic")} className="mt-1" />
                  <span>Jangan simpan apa pun sampai semua baris diperbaiki (semua atau tidak sama sekali)</span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="import-mode" checked={mode === "skip-invalid"} onChange={() => setMode("skip-invalid")} className="mt-1" />
                  <span>Simpan baris yang valid dan lewati baris yang bermasalah</span>
                </label>
              </fieldset>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={pending || summary.created + summary.updated === 0 || (mode === "atomic" && summary.errors > 0) || (needsNames && !confirmNew)} onClick={save}>
                {pending ? "Menyimpan…" : `Simpan ${summary.created} baru dan ${summary.updated} diperbarui`}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={check}>
                Periksa ulang
              </Button>
              {mode === "atomic" && summary.errors > 0 ? <span className="text-sm text-muted-foreground">Perbaiki baris yang bermasalah di Excel lalu pilih berkas lagi, atau pilih untuk melewatinya.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** One field: which column of the sheet holds it. A column already given to another field is not offered. */
function ColumnSelect({ id, label, hint, value, headers, used, none = "Pilih kolom", onChange }: { id: string; label: string; hint?: string; value: number | null; headers: string[]; used: Set<number>; none?: string; onChange: (column: number | null) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} value={value === null ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}>
        <option value="">{none}</option>
        {headers.map((header, index) => (used.has(index) && index !== value ? null : (
          <option key={index} value={index}>
            {columnLabel(index, header)}
          </option>
        )))}
      </NativeSelect>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function RowDetails({ row }: { row: SyncRowReport }) {
  if (row.messages.length === 0 && row.changes.length === 0) return <>–</>;
  return (
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
  );
}

function SyncTable({ summary }: { summary: SyncSummary }) {
  if (summary.rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Baris sheet</TableHead>
            <TableHead>Hasil</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Rincian</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.rows.map((row) => (
            <TableRow key={`${row.status}-${row.sheetRow}`}>
              <TableCell className="tabular-nums">{row.sheetRow}</TableCell>
              <TableCell className={STATUS_CLASS[row.status]}>{STATUS_TEXT[row.status]}</TableCell>
              <TableCell className="max-w-64">
                {row.code ? <span className="font-mono text-xs">{row.code}</span> : null}
                <span className="block truncate">{row.name || "–"}</span>
                <span className="block truncate text-xs text-muted-foreground">{row.endUser || "–"}</span>
              </TableCell>
              <TableCell>
                <RowDetails row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {summary.detailTruncated ? <p className="mt-2 text-xs text-muted-foreground">Hanya baris pertama yang ditampilkan; jumlah di atas mencakup semua baris.</p> : null}
    </div>
  );
}

/** What was saved: the new projects with their numbers, and the updated ones with what changed. */
function ResultTable({ result }: { result: Extract<SyncCommitResult, { ok: true }> }) {
  if (result.created.length + result.updated.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hasil</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Rincian</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.created.map((project) => (
            <TableRow key={`new-${project.code}`}>
              <TableCell className={STATUS_CLASS.new}>{STATUS_TEXT.new}</TableCell>
              <TableCell className="max-w-64">
                <span className="font-mono text-xs">{project.code}</span>
                <span className="block truncate">{project.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{project.endUser}</span>
              </TableCell>
              <TableCell>–</TableCell>
            </TableRow>
          ))}
          {result.updated.map((project) => (
            <TableRow key={`update-${project.code}`}>
              <TableCell>{STATUS_TEXT.update}</TableCell>
              <TableCell className="max-w-64">
                <span className="font-mono text-xs">{project.code}</span>
                <span className="block truncate">{project.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{project.endUser}</span>
              </TableCell>
              <TableCell>
                {project.changes.length === 0 ? (
                  "–"
                ) : (
                  <ul className="list-disc pl-4">
                    {project.changes.map((change) => (
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
    </div>
  );
}

/** One numbered step of the dialog. The number is also in the heading text, so the order reads without the circle. */
function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 p-4">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 className="text-base font-semibold">
          <span className="sr-only">Langkah {number}: </span>
          {title}
        </h2>
        {children}
      </div>
    </li>
  );
}

/**
 * The downloads: the current projects as a sheet to edit, and the blank template for new projects. A native details element keeps the menu
 * keyboard and screen-reader friendly without a menu library.
 */
function TemplateMenu({ canCreate, canUpdate }: { canCreate: boolean; canUpdate: boolean }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  // A details element only toggles from its own summary. While the menu is open, a press anywhere else, Escape, or tabbing out closes it too.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: Event) => {
      if (menu.current && !menu.current.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape also closes the dialog; the menu takes it first.
      event.preventDefault();
      event.stopPropagation();
      close();
      menu.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const item = "flex flex-col rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  if (!canUpdate || !canCreate) {
    return (
      <a href={canCreate ? "/export/projects-template" : "/export/projects?format=import"} download className={cn(buttonVariants({ variant: "outline" }), "self-start")}>
        <Download aria-hidden data-icon="inline-start" />
        {canCreate ? "Unduh template project baru" : "Export data project Anda"}
      </a>
    );
  }
  return (
    <details ref={menu} open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="relative self-start">
      <summary className={cn(buttonVariants({ variant: "outline" }), "list-none marker:content-none")}>
        <Download aria-hidden data-icon="inline-start" />
        Unduh berkas
        <ChevronDown aria-hidden data-icon="inline-end" />
      </summary>
      <div className="absolute top-full left-0 z-20 mt-1 flex w-72 max-w-[calc(100vw-4rem)] flex-col gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
        <a href="/export/projects?format=import" download onClick={() => setOpen(false)} className={item}>
          <span className="font-medium">Data project saat ini</span>
          <span className="text-xs text-muted-foreground">Kolom bagian peran Anda, untuk diedit lalu diunggah.</span>
        </a>
        <a href="/export/projects-template" download onClick={() => setOpen(false)} className={item}>
          <span className="font-medium">Template project baru</span>
          <span className="text-xs text-muted-foreground">Hanya nama kolom, untuk menambah project.</span>
        </a>
      </div>
    </details>
  );
}
