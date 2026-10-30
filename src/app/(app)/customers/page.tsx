import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { formatDay } from "@/features/dashboards/format";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { CustomerDialog } from "@/features/customers/customer-dialog";
import { can } from "@/domain/access/permissions";
import { listCustomers, listIndustrySuggestions } from "@/server/customers/queries";
import { listCustomerOptions } from "@/server/requests/queries";


export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

async function Customers({ searchParams }: Pick<PageProps<"/customers">, "searchParams">) {
  const viewer = await requirePermission("customers.view");
  const query = await searchParams;
  const search = (typeof query.q === "string" ? query.q : "").slice(0, 100);
  const [customers, suggestions] = await Promise.all([listCustomers(getDb(), viewer, search), listIndustrySuggestions(getDb(), viewer)]);
  const canEdit = can(viewer.role, "customers.edit");
  const canRename = can(viewer.role, "customers.rename");
  // Merging may point at any customer, not only the ones the search shows.
  const allCustomers = canRename ? await listCustomerOptions(getDb(), viewer) : [];

  return (
    <>
      <DashboardHeader
        title="Customers"
        summary="Perusahaan end-user dari proyek Anda. Klik customer untuk memilih industrinya."
      />
      <form role="search" className="mb-4 flex gap-2">
        <Input name="q" defaultValue={search} placeholder="Cari customer" aria-label="Search customers" maxLength={100} className="max-w-md" />
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Search
        </button>
        <Link href={`${PROJECTS_PATH}/new`} className={buttonVariants()}>
          New project
        </Link>
      </form>
      {customers.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {search ? "Tidak ada customer yang cocok." : "Belum ada customer. Buat sebuah proyek dan end-user company-nya akan muncul di sini."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead className="text-right">Projects</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="hidden md:table-cell">Latest project</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  <CustomerDialog
                    customer={{ id: customer.id, name: customer.name, industry: customer.industry, projects: customer.projects }}
                    industries={suggestions}
                    canEdit={canEdit}
                    projectsHref={`${PROJECTS_PATH}?q=${encodeURIComponent(customer.name)}`}
                    others={canRename ? allCustomers.filter((other) => other.id !== customer.id) : undefined}
                  />
                </TableCell>
                <TableCell>{customer.industry ?? <span className="text-muted-foreground">Not set</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{customer.projects}</TableCell>
                <TableCell className="text-right tabular-nums">{customer.openProjects}</TableCell>
                <TableCell className="hidden whitespace-nowrap md:table-cell">{customer.lastProjectAt ? formatDay(customer.lastProjectAt) : "–"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
