"use client"

import * as React from "react"
import { cn } from "cn"

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const isBlank = (text: string) => text === "" || /^[–-]+$/.test(text)

/** The header cells a click can sort: plain text, no link or button of their own (those lists are sorted by the server). */
function sortableHeads(table: HTMLTableElement): HTMLTableCellElement[] {
  const heads = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"))
  const body = table.tBodies[0]
  if (!body || heads.length === 0) return []
  const rows = Array.from(body.rows)
  // A table with merged cells, or rows of a different width than the header, is left as it is.
  if (
    rows.length < 2 ||
    rows.some(
      (row) =>
        row.cells.length !== heads.length ||
        Array.from(row.cells).some((cell) => cell.colSpan > 1 || cell.rowSpan > 1)
    )
  ) {
    return []
  }
  return heads.filter(
    (head) => head.colSpan === 1 && head.textContent?.trim() && !head.querySelector("a, button, input, select")
  )
}

/** Sorts the rows of the first body by one column, A to Z first, then Z to A on the next click. Empty cells always go last. */
function sortColumn(table: HTMLTableElement, head: HTMLTableCellElement): void {
  const body = table.tBodies[0]
  if (!body) return
  const column = head.cellIndex
  const descending = head.getAttribute("aria-sort") === "ascending"
  const text = (row: HTMLTableRowElement) => (row.cells[column]?.textContent ?? "").replace(/\s+/g, " ").trim()
  const rows = Array.from(body.rows).sort((a, b) => {
    const left = text(a)
    const right = text(b)
    if (isBlank(left) || isBlank(right)) return Number(isBlank(left)) - Number(isBlank(right))
    return descending ? collator.compare(right, left) : collator.compare(left, right)
  })
  for (const other of Array.from(table.querySelectorAll("thead th"))) other.removeAttribute("aria-sort")
  head.setAttribute("aria-sort", descending ? "descending" : "ascending")
  for (const row of rows) body.appendChild(row)
}

function Table({ className, topScroll = false, ...props }: React.ComponentProps<"table"> & { topScroll?: boolean }) {
  const ref = React.useRef<HTMLTableElement>(null)
  const container = React.useRef<HTMLDivElement>(null)
  const top = React.useRef<HTMLDivElement>(null)
  const topInner = React.useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = React.useState(false)
  // A wide table gets a second scrollbar above it, kept in step with the one below, so nobody has to scroll to the bottom to move sideways.
  React.useEffect(() => {
    const table = ref.current
    const box = container.current
    if (!topScroll || !table || !box) return
    const measure = () => {
      if (topInner.current) topInner.current.style.width = `${table.scrollWidth}px`
      setOverflowing(table.scrollWidth > box.clientWidth + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    observer.observe(box)
    return () => observer.disconnect()
  }, [topScroll])
  const syncing = React.useRef(false)
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) {
      syncing.current = false
      return
    }
    syncing.current = true
    to.scrollLeft = from.scrollLeft
  }
  // Marks the sortable headers once the page is interactive, so a header that cannot sort never looks clickable.
  React.useEffect(() => {
    const table = ref.current
    if (!table) return
    for (const head of sortableHeads(table)) {
      head.dataset["sortable"] = "true"
      head.tabIndex = 0
      head.title = "Sort A to Z (click again for Z to A)"
    }
  })
  const sortFrom = (target: EventTarget | null) => {
    const table = ref.current
    const head = target instanceof Element ? target.closest<HTMLTableCellElement>("thead th[data-sortable]") : null
    if (table && head) sortColumn(table, head)
  }
  return (
    <>
    {topScroll && overflowing ? (
      <div
        ref={top}
        data-slot="table-top-scroll"
        aria-hidden
        className="w-full overflow-x-auto overflow-y-hidden"
        onScroll={() => follow(top.current, container.current)}
      >
        <div ref={topInner} className="h-3" />
      </div>
    ) : null}
    <div
      ref={container}
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
      onScroll={() => follow(container.current, top.current)}
    >
      <table
        ref={ref}
        data-slot="table"
        className={cn(
          "w-full caption-bottom text-sm",
          "[&_th[data-sortable]]:cursor-pointer [&_th[data-sortable]]:select-none [&_th[data-sortable]:hover]:underline",
          "[&_th[data-sortable][aria-sort=ascending]]:after:content-['_↑'] [&_th[data-sortable][aria-sort=descending]]:after:content-['_↓']",
          className
        )}
        onClick={(event) => sortFrom(event.target)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            const onHead = event.target instanceof Element && event.target.closest("thead th[data-sortable]")
            if (onHead) {
              event.preventDefault()
              sortFrom(event.target)
            }
          }
        }}
        {...props}
      />
    </div>
    </>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
