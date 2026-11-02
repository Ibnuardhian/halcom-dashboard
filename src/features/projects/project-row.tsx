"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

/**
 * A table row that opens the project when it is clicked anywhere. The Project ID link stays the keyboard and screen-reader way in; a click on a link
 * or button inside the row does its own thing, and a click that ends a text selection does not navigate.
 */
export function ProjectRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <TableRow
      className="cursor-pointer"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button, input, select, textarea")) return;
        if (window.getSelection()?.toString()) return;
        router.push(href);
      }}
    >
      {children}
    </TableRow>
  );
}
