"use client";

import { useActionState, useId, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteIndustryAction, renameIndustryAction } from "@/features/customers/actions";
import { deleteMasterRecordAction, renameMasterRecordAction } from "./actions";

export type MasterListKind = "principal" | "solution" | "industry";
export type MasterListItem = { id: string; name: string; count: number };

const PAGE_SIZE = 10;
/** What the number beside a name counts: the projects of a Principal or Solution, the customers of an industry. */
const UNIT: Record<MasterListKind, string> = { principal: "project", solution: "project", industry: "customer" };

/**
 * A master-data list as a table with a search box and pages of ten, so the page stays short however long the list gets. Each row has
 * the number of projects (or customers) that use the name and one Edit button that opens a window to rename or delete it.
 */
export function MasterList({ kind, label, items }: { kind: MasterListKind; label: string; items: MasterListItem[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const shown = useMemo(() => items.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase())), [items, query]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(0);
        }}
        placeholder={`Cari ${label.toLowerCase()}`}
        aria-label={`Cari ${label}`}
        maxLength={100}
        className="max-w-sm"
      />
      {items.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Belum ada.
        </p>
      ) : shown.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Tidak ada yang cocok dengan pencarian.
        </p>
      ) : (
        <Table aria-label={`Daftar ${label}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Dipakai</TableHead>
              <TableHead className="w-24 text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>
                  {item.count > 0 ? (
                    <Badge variant="secondary">
                      {item.count} {UNIT[kind]}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Belum dipakai</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <EditRecord kind={kind} item={item} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {shown.length > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Menampilkan {current * PAGE_SIZE + 1}–{Math.min(shown.length, current * PAGE_SIZE + PAGE_SIZE)} dari {shown.length}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Sebelumnya
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Berikutnya
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The one button of a row: opens a window with the rename form and, below it, the delete button (off while the name is in use). */
function EditRecord({ kind, item }: { kind: MasterListKind; item: MasterListItem }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [renamed, rename, renaming] = useActionState<FormState, FormData>(kind === "industry" ? renameIndustryAction : renameMasterRecordAction, null);
  const [deleted, remove, deleting] = useActionState<FormState, FormData>(kind === "industry" ? deleteIndustryAction : deleteMasterRecordAction, null);
  const unit = UNIT[kind];

  return (
    <>
      <Button type="button" variant="outline" size="sm" aria-haspopup="dialog" aria-label={`Edit ${item.name}`} onClick={() => dialog.current?.showModal()}>
        Edit
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-left text-card-foreground shadow-xl backdrop:bg-black/40"
        onClick={(event) => {
          // A click on the dimmed area outside the window closes it.
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="flex flex-col gap-5 p-5">
          <div>
            <h2 id={`${id}-title`} className="font-heading text-lg font-semibold">
              Edit {item.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {item.count > 0 ? `Dipakai ${item.count} ${unit}.` : `Belum dipakai oleh ${unit} mana pun.`}
            </p>
          </div>
          <form key={item.name} action={rename} className="flex flex-col gap-1.5">
            {kind === "industry" ? null : <input type="hidden" name="kind" value={kind} />}
            <input type="hidden" name="id" value={item.id} />
            <Label htmlFor={`${id}-name`}>Nama</Label>
            <div className="flex gap-2">
              <Input id={`${id}-name`} name="name" defaultValue={item.name} maxLength={120} required autoComplete="off" />
              <Button type="submit" disabled={renaming}>
                {renaming ? "Menyimpan…" : "Simpan"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Nama berubah di semua {unit} yang memakainya. Nama harus unik, tanpa membedakan huruf besar kecil dan spasi.</p>
            <FormStatus state={renamed} />
          </form>
          <form action={remove} className="flex flex-col gap-1.5 border-t pt-4">
            {kind === "industry" ? null : <input type="hidden" name="kind" value={kind} />}
            <input type="hidden" name="id" value={item.id} />
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{item.count > 0 ? `Tidak bisa dihapus: masih dipakai ${item.count} ${unit}.` : "Hapus nama ini dari daftar."}</p>
              <Button type="submit" variant="destructive" disabled={deleting || item.count > 0} aria-label={`Hapus ${item.name}`}>
                Hapus
              </Button>
            </div>
            <FormStatus state={deleted} />
          </form>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>
              Tutup
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
